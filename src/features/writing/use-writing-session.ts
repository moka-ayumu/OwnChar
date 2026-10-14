import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { FixedRule, GuideMode, WritingExercise } from '@/collection/exercises'
import type { NormalizedShape } from '@/font/geometry/shape'
import type { CompositionSettings } from '@/font/settings'
import { cellId, guideSourceTag, type DrawingRecord, type JamoBoundary, type WritingSessionRecord } from '@/collection/records'
import { composeCellGuide, type StoredCellGuide } from '@/font/guides'
import { isHangulSyllable, type HangulRole } from '@/font/hangul'
import { REFERENCE_CELL_SIZE, strokeSvgPath, type RawStroke } from '@/font/stroke/outline'
import { guideComposeOptions, type HangulCompositionInputs } from '@/generation/font-builder'
import { cancelIdle, stopWhenBusy, whenIdle } from '@/lib/idle'
import { useCompositionBase, warmCompositionBase } from '@/generation/use-composition-context'
import { completedHangulCells } from '@/generation/learning/samples'
import { projectActions } from '@/project/store'
import { useProject } from '@/project/use-project'
import { assignStrokes, boundariesThrough, captureRecords, cellIndexOf, cellProgress, completedCells, fixedSlots, holdBoundaries, reflowStrokes, visibleStrokes, type CanvasGrid } from './stroke-assignment'

type Boundaries = Record<number, JamoBoundary[]>
type Guides = Record<number, StoredCellGuide>
/** For a cell, the position of the editable slot its writer keeps open. */
type Holds = Record<number, number>

/** Two guide maps are the same when every cell keeps the same stored role outlines. */
function sameGuides(left: Guides, right: Guides) {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => {
    const a = left[Number(key)]
    const b = right[Number(key)]
    if (!b) return false
    const roles = Object.keys(a.roles) as HangulRole[]
    return roles.length === Object.keys(b.roles).length
      && roles.every((role) => a.roles[role] === b.roles[role])
      && JSON.stringify(a.placeholders) === JSON.stringify(b.placeholders)
  })
}

const NO_GUIDES: Guides = {}

/** The guide of a written cell that keeps nothing fixed. It pins the cell, so its strokes keep the jamo they were given. */
const EMPTY_CELL_GUIDE: StoredCellGuide = { roles: {}, placeholders: {}, bands: {} }

const pinnedGuides = new WeakMap<WritingSessionRecord, Guides>()

/**
 * The guides a saved sentence starts with. A syllable cell written without a
 * stored guide had nothing fixed, so it gets an empty one: what the writer
 * shows later must not change how its strokes are read.
 */
function savedGuides(saved: WritingSessionRecord | undefined, exercise: WritingExercise): Guides {
  if (!saved) return NO_GUIDES
  const kept = pinnedGuides.get(saved)
  if (kept) return kept
  const grid = { cellSize: saved.cellSize, columns: saved.columns }
  let guides = saved.guides
  for (const stroke of visibleStrokes(saved.elements)) {
    const index = cellIndexOf(stroke, grid, exercise.cells.length)
    if (guides[index] || !isHangulSyllable(exercise.cells[index].char.codePointAt(0)!)) continue
    if (guides === saved.guides) guides = { ...guides }
    guides[index] = EMPTY_CELL_GUIDE
  }
  pinnedGuides.set(saved, guides)
  return guides
}

/** What a sentence fixes, from the guides its written cells kept and whether collected jamo are shown at all. */
function guideRule(storedGuides: Guides, blank: boolean): FixedRule {
  return { mode: blank ? 'blank' : 'collected', pinned: Object.fromEntries(Object.entries(storedGuides).map(([index, guide]) => [index, Object.keys(guide.roles) as HangulRole[]])) }
}

/** Completed syllables after which the learned size is the writer's own, not the default. */
const SIZE_KNOWN_AFTER = 3
/** How long the canvas width must hold still before the cells are laid out again. */
const RESIZE_SETTLE_MS = 120

interface GuideJob {
  inputs: readonly unknown[]
  options: ReturnType<typeof guideComposeOptions>
  guides: Map<number, StoredCellGuide>
  /** The next cell to compose. */
  next: number
  /** Cells composed ahead of `next`. */
  settled: Set<number>
  /** The last finished job of the sentence: its guides are shown while this job is not finished. */
  previous?: GuideJob
  /** What is shown while this job is not finished: the guides of `previous`, with the cells that cannot wait made new. */
  display?: Map<number, StoredCellGuide>
}

const guideJobDone = (exercise: WritingExercise, job: GuideJob) => job.next >= exercise.cells.length

const guideJobs = new WeakMap<WritingExercise, GuideJob>()

/** The job that composes the guides of a sentence for these inputs; the same inputs give back the same job, finished or not. */
function guideJob(exercise: WritingExercise, drawings: Record<string, DrawingRecord>, storedGuides: Guides, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, composition: HangulCompositionInputs, mode: GuideMode) {
  const inputs = [drawings, storedGuides, shapes, settings, composition, mode === 'blank']
  const kept = guideJobs.get(exercise)
  if (kept && kept.inputs.every((input, index) => Object.is(input, inputs[index]))) return kept
  const base = kept && (guideJobDone(exercise, kept) ? kept : kept.previous)
  if (base) base.previous = undefined
  const job: GuideJob = { inputs, options: guideComposeOptions(composition), guides: new Map(), next: 0, settled: new Set(), previous: base }
  guideJobs.set(exercise, job)
  return job
}

function composeJobCell(exercise: WritingExercise, job: GuideJob, cellIndex: number) {
  const [drawings, storedGuides, shapes, settings, , blank] = job.inputs as [Record<string, DrawingRecord>, Guides, Map<string, NormalizedShape>, CompositionSettings, unknown, boolean]
  const cell = exercise.cells[cellIndex]
  const codePoint = cell.char.codePointAt(0)!
  const fixed = fixedSlots(cell, cellIndex, exercise, drawings, guideRule(storedGuides, blank))
  job.settled.add(cellIndex)
  if (!isHangulSyllable(codePoint) || !fixed.length) return
  const guideRoles = Object.fromEntries(fixed.map(({ slot }) => [slot.role!, guideSourceTag(drawings[slot.promptId])]))
  const writtenRoles = cell.slots.filter((slot) => {
    const written = drawings[slot.promptId]?.capture
    return written?.exerciseId === exercise.id && written.cellIndex === cellIndex
  }).map((slot) => slot.role!)
  job.guides.set(cellIndex, composeCellGuide({
    codePoint, cellId: cellId(exercise.id, cellIndex), guideRoles, writtenRoles,
    stored: storedGuides[cellIndex], shapes, settings, options: job.options,
  }))
}

/** Composes the cells of a job one at a time until all are done or `shouldStop` says so. Returns whether all are done. */
function advanceGuideJob(exercise: WritingExercise, job: GuideJob, shouldStop?: () => boolean) {
  while (job.next < exercise.cells.length) {
    if (!job.settled.has(job.next)) {
      if (shouldStop?.()) return false
      composeJobCell(exercise, job, job.next)
    }
    job.next += 1
  }
  return true
}

/**
 * The job for the guides of a sentence. With nothing to show yet, it is
 * finished here. Otherwise the guides shown before stay until it is finished
 * in idle time, so a save never stops the writer for them. Only a cell whose
 * fixed jamo changed, or whose stored guide appeared or went, is made new at
 * once: its old guide would show the wrong jamo to write.
 */
function sentenceGuideJob(exercise: WritingExercise, drawings: Record<string, DrawingRecord>, storedGuides: Guides, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, composition: HangulCompositionInputs, mode: GuideMode) {
  const job = guideJob(exercise, drawings, storedGuides, shapes, settings, composition, mode)
  if (!job.previous) {
    advanceGuideJob(exercise, job)
    return job
  }
  if (!job.display) {
    const previous = job.previous
    const previousStored = previous.inputs[1] as Guides
    const display = new Map(previous.guides)
    const rule = guideRule(storedGuides, mode === 'blank')
    exercise.cells.forEach((cell, cellIndex) => {
      const roles = fixedSlots(cell, cellIndex, exercise, drawings, rule).map(({ slot }) => slot.role!).sort().join()
      const shown = Object.keys(previous.guides.get(cellIndex)?.roles ?? {}).sort().join()
      if (roles === shown && Boolean(previousStored[cellIndex]) === Boolean(storedGuides[cellIndex])) return
      composeJobCell(exercise, job, cellIndex)
      const fresh = job.guides.get(cellIndex)
      if (fresh) display.set(cellIndex, fresh)
      else display.delete(cellIndex)
    })
    job.display = display
  }
  return job
}

const countBoundaries = (boundaries: Boundaries) => Object.values(boundaries).reduce((sum, items) => sum + items.length, 0)

/** How many strokes of a sentence have their outline made, for the stroke conditioning in use. */
const outlineProgress = new WeakMap<readonly RawStroke[], { endpointStabilization: number; next: number }>()

/**
 * Prepares a sentence the writer is likely to open next: its guides and the
 * outlines of its strokes. Stops when `shouldStop` says so and returns
 * whether it is done; calling again carries on where it stopped.
 */
export function warmSentence(exercise: WritingExercise, drawings: Record<string, DrawingRecord>, sessions: Record<string, WritingSessionRecord>, settings: CompositionSettings, mode: GuideMode, shouldStop: () => boolean) {
  const { shapes, composition } = warmCompositionBase(drawings, sessions, settings)
  const saved = sessions[exercise.id] as WritingSessionRecord | undefined
  if (!advanceGuideJob(exercise, guideJob(exercise, drawings, savedGuides(saved, exercise), shapes, settings, composition, mode), shouldStop)) return false
  const elements = saved?.elements ?? []
  const progress = outlineProgress.get(elements)
  let index = progress?.endpointStabilization === settings.endpointStabilization ? progress.next : 0
  for (; index < elements.length; index += 1) {
    if (shouldStop()) {
      outlineProgress.set(elements, { endpointStabilization: settings.endpointStabilization, next: index })
      return false
    }
    const stroke = elements[index]
    if (!stroke.isDeleted && stroke.points.length) strokeSvgPath(stroke, saved!.cellSize, settings.endpointStabilization)
  }
  outlineProgress.set(elements, { endpointStabilization: settings.endpointStabilization, next: index })
  return true
}

/**
 * The strokes, jamo boundaries and guides of the sentence being written, saved
 * as they change. `viewport` is the element the canvas scrolls in.
 */
export function useWritingSession(exercise: WritingExercise, viewport: RefObject<HTMLDivElement | null>) {
  const drawings = useProject((state) => state.drawings)
  const sessions = useProject((state) => state.writingSessions)
  const guideMode = useProject((state) => state.guideMode)
  const settings = useProject((state) => state.compositionSettings)
  const saved = sessions[exercise.id] as WritingSessionRecord | undefined
  const [cellSize, setCellSize] = useState(saved?.cellSize ?? REFERENCE_CELL_SIZE)
  const [requestedColumns, setColumns] = useState(saved?.columns ?? Math.min(6, exercise.cells.length))
  const [strokes, setStrokes] = useState<readonly RawStroke[]>(saved?.elements ?? [])
  const [boundaries, setBoundaries] = useState<Boundaries>(saved?.boundaries ?? {})
  const [storedGuides, setStoredGuides] = useState<Guides>(() => savedGuides(saved, exercise))
  // The guides of cells whose strokes were all taken back, so strokes brought back are read as they were.
  const [released, setReleased] = useState<Guides>(NO_GUIDES)
  const [boundaryWarning, setBoundaryWarning] = useState('')
  const [holds, setHolds] = useState<Holds>({})
  const [focus, setFocus] = useState<number | null>(null)
  const boundariesRef = useRef(boundaries)
  const holdsRef = useRef(holds)
  const guidesRef = useRef(storedGuides)
  const saveTimer = useRef<number | undefined>(undefined)
  const lastRevision = useRef('')
  const columns = Math.max(1, Math.min(requestedColumns, exercise.cells.length))
  const grid = useMemo<CanvasGrid>(() => ({ cellSize, columns }), [cellSize, columns])
  const cellCount = exercise.cells.length

  // The canvas always fills the available width; written strokes follow their cells.
  const current = useRef({ strokes, grid, save: (() => {}) as (next: readonly RawStroke[], requested: Boundaries, grid: CanvasGrid) => void })
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const reflow = (width: number) => {
      const { strokes: written, grid: shown, save: persist } = current.current
      const available = Math.max(cellSize, width)
      const next = Math.max(1, Math.min(cellCount, Math.floor(available / cellSize)))
      if (next === shown.columns) return
      setColumns(next)
      if (!written.length) return
      lastRevision.current = ''
      persist(reflowStrokes(written, shown, { cellSize, columns: next }, cellCount), boundariesRef.current, { cellSize, columns: next })
    }
    // The first size lays the canvas out at once. While the width keeps changing (a dragged window edge,
    // a turning phone) the reflow waits for it to settle, so it runs once instead of at every column it crosses.
    let timer = 0
    let first = true
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      window.clearTimeout(timer)
      if (first) { first = false; reflow(width); return }
      timer = window.setTimeout(() => reflow(width), RESIZE_SETTLE_MS)
    })
    observer.observe(element)
    return () => { window.clearTimeout(timer); observer.disconnect() }
  }, [cellSize, cellCount, exercise.id, viewport])

  // Learned spacing and calibration stay as they were when the sentence was
  // opened, so completing other syllables never moves a guide on screen. They
  // are learned once more when the writer's own size is first known.
  const sizeCounted = useMemo(() => completedHangulCells(sessions).length >= SIZE_KNOWN_AFTER, [sessions])
  const sizeKnownRef = useRef(false)
  if (sizeCounted) sizeKnownRef.current = true
  const sizeKnown = sizeKnownRef.current
  const { shapes, composition } = useCompositionBase(drawings, sessions, settings, `${exercise.id}|${JSON.stringify(settings)}|${sizeKnown}`)
  const guideJobNow = sentenceGuideJob(exercise, drawings, storedGuides, shapes, settings, composition, guideMode)
  const [, setFinishedCount] = useState(0)
  useEffect(() => {
    if (guideJobDone(exercise, guideJobNow)) return
    let handle = whenIdle(function step(time) {
      if (advanceGuideJob(exercise, guideJobNow, stopWhenBusy(time))) setFinishedCount((count) => count + 1)
      else handle = whenIdle(step)
    })
    return () => cancelIdle(handle)
  }, [exercise, guideJobNow])
  const cellGuides = guideJobDone(exercise, guideJobNow) ? guideJobNow.guides : guideJobNow.display!

  const writtenCells = useMemo(() => new Set(visibleStrokes(strokes).map((stroke) => cellIndexOf(stroke, grid, cellCount))), [strokes, grid, cellCount])

  // A cell keeps the jamo it had fixed when its first stroke began, whatever is shown later.
  const fixedRule = useMemo<FixedRule>(() => {
    const roles = (guide: StoredCellGuide) => Object.keys(guide.roles) as HangulRole[]
    const pinned: Record<number, HangulRole[]> = {}
    for (const [index, guide] of cellGuides) pinned[index] = roles(guide)
    for (const index of writtenCells) {
      const kept = storedGuides[index] ?? released[index]
      if (kept) pinned[index] = roles(kept)
    }
    for (const [index, guide] of Object.entries(storedGuides)) pinned[Number(index)] = roles(guide)
    return { mode: guideMode, pinned }
  }, [cellGuides, storedGuides, released, writtenCells, guideMode])
  const capture = useMemo(() => assignStrokes(strokes, grid, exercise, drawings, boundaries, fixedRule), [strokes, grid, exercise, drawings, boundaries, fixedRule])

  // A cell keeps the guide it showed when its first stroke began: the stored
  // outlines are what the canvas and the font use from then on. A syllable cell
  // written with nothing fixed keeps an empty guide, so it is read the same
  // later. A cell of another character that was fixed keeps none: it stays
  // fixed whenever collected jamo are shown.
  useEffect(() => {
    const next: Guides = {}
    const nextReleased: Guides = { ...released }
    for (const index of writtenCells) {
      const stored = guidesRef.current[index]
      const pinOnly = stored ? (Object.keys(stored.roles).length ? undefined : stored) : released[index]
      const guide = cellGuides.get(index)
      const shown = guide && Object.keys(guide.roles).length ? guide : undefined
      const cell = exercise.cells[index]
      if (pinOnly) next[index] = pinOnly
      else if (shown) next[index] = shown
      else if (isHangulSyllable(cell.char.codePointAt(0)!) || !fixedSlots(cell, index, exercise, drawings, fixedRule).length) next[index] = EMPTY_CELL_GUIDE
      delete nextReleased[index]
    }
    for (const [index, guide] of Object.entries(guidesRef.current)) if (!writtenCells.has(Number(index))) nextReleased[Number(index)] = guide
    const releasedKeys = Object.keys(nextReleased)
    if (releasedKeys.length !== Object.keys(released).length || releasedKeys.some((key) => nextReleased[Number(key)] !== released[Number(key)])) setReleased(nextReleased)
    if (sameGuides(next, guidesRef.current)) return
    guidesRef.current = next
    setStoredGuides(next)
    projectActions.saveSessionGuides(exercise.id, next)
  }, [writtenCells, cellGuides, released, exercise, drawings, fixedRule])

  const save = (nextStrokes: readonly RawStroke[], confirmedBoundaries = boundariesRef.current, target: CanvasGrid = grid) => {
    const requestedBoundaries = holdBoundaries(confirmedBoundaries, holdsRef.current, nextStrokes, target, exercise, drawings, fixedRule)
    const assigned = assignStrokes(nextStrokes, target, exercise, drawings, requestedBoundaries, fixedRule)
    if (JSON.stringify(assigned.boundaries) !== JSON.stringify(boundaries)) {
      if (countBoundaries(assigned.boundaries) < countBoundaries(requestedBoundaries)) setBoundaryWarning('나눠 둔 획이 지워졌어요. 자모가 맞게 나뉘었는지 확인해 주세요.')
      boundariesRef.current = assigned.boundaries
      setBoundaries(assigned.boundaries)
    }
    const revision = `${nextStrokes.map((stroke) => `${stroke.id}:${stroke.version}:${stroke.isDeleted ? 1 : 0}`).join('|')}::${JSON.stringify(assigned.boundaries)}`
    if (revision === lastRevision.current) return
    lastRevision.current = revision
    setStrokes(nextStrokes)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      projectActions.saveSentenceCapture({
        exerciseId: exercise.id, text: exercise.text,
        elements: structuredClone(nextStrokes),
        assignments: assigned.assignments, boundaries: assigned.boundaries,
        cellSize: target.cellSize, columns: target.columns, updatedAt: Date.now(), guides: guidesRef.current,
      }, captureRecords(assigned.groups, target, exercise.id, settings.endpointStabilization))
    }, 250)
  }
  current.current = { strokes, grid, save }

  const reset = (nextBoundaries: Boundaries) => {
    boundariesRef.current = nextBoundaries
    setBoundaries(nextBoundaries)
    setBoundaryWarning('')
    holdsRef.current = {}
    setHolds({})
    setFocus(null)
  }

  /** Sets the confirmed boundaries of one cell and which of its slots, if any, stays open. */
  const divideCell = (cellIndex: number, cellBoundaries: JamoBoundary[], held?: number) => {
    const nextHolds = { ...holdsRef.current }
    if (held === undefined) delete nextHolds[cellIndex]
    else nextHolds[cellIndex] = held
    holdsRef.current = nextHolds
    setHolds(nextHolds)
    const next = { ...boundaries }
    if (cellBoundaries.length) next[cellIndex] = cellBoundaries
    else delete next[cellIndex]
    setBoundaryWarning('')
    boundariesRef.current = next
    setBoundaries(next)
    save(strokes, next)
  }

  const finished = useMemo(() => completedCells(strokes, grid, exercise, capture.groups, boundaries, holds), [strokes, grid, exercise, capture, boundaries, holds])

  // The cell being collected is the one of the latest stroke, or one the writer reopened.
  const latest = visibleStrokes(strokes).at(-1)
  const latestCellIndex = latest ? cellIndexOf(latest, grid, cellCount) : null
  const activeCellIndex = focus ?? latestCellIndex
  const confirmed = activeCellIndex === null ? [] : boundaries[activeCellIndex] ?? []
  // A hold counts only while the boundaries before it stand.
  const held = activeCellIndex !== null && holds[activeCellIndex] !== undefined && confirmed.length >= holds[activeCellIndex] ? holds[activeCellIndex] : undefined
  const slots = activeCellIndex === null ? [] : cellProgress(activeCellIndex, capture.groups, boundaries, held)
  const open = slots.findIndex((slot) => !slot.done)
  const writing = open < 0 ? null : open
  const target = writing === null ? undefined : slots[writing]

  return {
    grid,
    rowCount: Math.ceil(cellCount / columns),
    strokes,
    capture,
    cellGuides,
    /** Which slots each cell holds fixed. */
    fixedRule,
    boundaryWarning,
    /** Whether each cell has collected everything it can. */
    finished,
    /** The cell size can change only while nothing is written. */
    setCellSize,
    save(next: readonly RawStroke[]) {
      // Writing in another cell leaves the reopened one.
      const written = visibleStrokes(next).at(-1)
      if (focus !== null && written && written.id !== latest?.id && cellIndexOf(written, grid, cellCount) !== focus) setFocus(null)
      save(next)
    },
    clear() {
      setReleased(NO_GUIDES)
      reset({})
      save([], {})
    },
    active: {
      /** The cell whose jamo are being collected, when it collects any. */
      cellIndex: slots.length ? activeCellIndex : null,
      /** The jamo the cell collects, in writing order, and the position of the one being written. */
      slots,
      current: writing,
      /** Strokes the jamo being written usually still takes. */
      remaining: target ? Math.max(0, target.slot.expectedStrokes - target.count) : 0,
      canFinish: Boolean(target && target.count > 0),
      /** The writer opened this cell by hand, so it stays open when finished. */
      reopened: focus !== null,
    },
    /** Declares the jamo being written finished after the latest stroke of its cell. */
    finishActiveSlot() {
      if (activeCellIndex === null || writing === null || !target?.count) return
      const next = boundariesThrough(activeCellIndex, writing + 1, capture.groups, confirmed.slice(0, writing), Date.now())
      if (next) divideCell(activeCellIndex, next)
    },
    /** Moves collection to another jamo of the cell: the jamo before it end where they stand, and it takes the strokes after them. */
    collectActiveSlot(index: number) {
      if (activeCellIndex === null || index === writing || !slots[index]) return
      const next = boundariesThrough(activeCellIndex, index, capture.groups, confirmed.slice(0, index), Date.now())
      if (!next) return
      // Going back holds the jamo open past its usual stroke count; the last one takes every further stroke anyway.
      const back = writing === null || index < writing
      divideCell(activeCellIndex, next, back && index < slots.length - 1 ? index : undefined)
    },
    /** Opens the jamo of a written cell, so their division can be changed. */
    reopenCell(cellIndex: number) { setFocus(cellIndex) },
    closeCell() { setFocus(null) },
  }
}
