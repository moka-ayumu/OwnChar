import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { WritingExercise } from '@/collection/exercises'
import { cellId, guideSourceTag, type JamoBoundary, type WritingSessionRecord } from '@/collection/records'
import { composeCellGuide, type StoredCellGuide } from '@/font/guides'
import { isHangulSyllable, type HangulRole } from '@/font/hangul'
import { REFERENCE_CELL_SIZE, type RawStroke } from '@/font/stroke/outline'
import { hangulComposeOptions } from '@/generation/font-builder'
import { useCompositionContext } from '@/generation/use-composition-context'
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

const countBoundaries = (boundaries: Boundaries) => Object.values(boundaries).reduce((sum, items) => sum + items.length, 0)

/**
 * The strokes, jamo boundaries and guides of the sentence being written, saved
 * as they change. `viewport` is the element the canvas scrolls in.
 */
export function useWritingSession(exercise: WritingExercise, viewport: RefObject<HTMLDivElement | null>) {
  const drawings = useProject((state) => state.drawings)
  const sessions = useProject((state) => state.writingSessions)
  const settings = useProject((state) => state.compositionSettings)
  const saved = sessions[exercise.id] as WritingSessionRecord | undefined
  const [cellSize, setCellSize] = useState(saved?.cellSize ?? REFERENCE_CELL_SIZE)
  const [requestedColumns, setColumns] = useState(saved?.columns ?? Math.min(6, exercise.cells.length))
  const [strokes, setStrokes] = useState<readonly RawStroke[]>(saved?.elements ?? [])
  const [boundaries, setBoundaries] = useState<Boundaries>(saved?.boundaries ?? {})
  const [storedGuides, setStoredGuides] = useState<Guides>(saved?.guides ?? {})
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
    const observer = new ResizeObserver(([entry]) => {
      const { strokes: written, grid: shown, save: persist } = current.current
      const available = Math.max(cellSize, entry.contentRect.width)
      const next = Math.max(1, Math.min(cellCount, Math.floor(available / cellSize)))
      if (next === shown.columns) return
      setColumns(next)
      if (!written.length) return
      lastRevision.current = ''
      persist(reflowStrokes(written, shown, { cellSize, columns: next }, cellCount), boundariesRef.current, { cellSize, columns: next })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [cellSize, cellCount, exercise.id, viewport])

  const capture = useMemo(() => assignStrokes(strokes, grid, exercise, drawings, boundaries), [strokes, grid, exercise, drawings, boundaries])

  // Learned spacing and calibration stay as they were when the sentence was
  // opened, so completing other syllables never moves a guide on screen.
  const { shapes, composition } = useCompositionContext(drawings, sessions, settings, `${exercise.id}|${JSON.stringify(settings)}`)
  const cellGuides = useMemo(() => {
    const options = hangulComposeOptions(composition)
    const guides = new Map<number, StoredCellGuide>()
    exercise.cells.forEach((cell, cellIndex) => {
      const codePoint = cell.char.codePointAt(0)!
      const fixed = fixedSlots(cell, cellIndex, exercise, drawings)
      if (!isHangulSyllable(codePoint) || !fixed.length) return
      const guideRoles = Object.fromEntries(fixed.map(({ slot }) => [slot.role!, guideSourceTag(drawings[slot.promptId])]))
      const writtenRoles = cell.slots.filter((slot) => {
        const written = drawings[slot.promptId]?.capture
        return written?.exerciseId === exercise.id && written.cellIndex === cellIndex
      }).map((slot) => slot.role!)
      guides.set(cellIndex, composeCellGuide({
        codePoint, cellId: cellId(exercise.id, cellIndex), guideRoles, writtenRoles,
        stored: storedGuides[cellIndex], shapes, settings, options,
      }))
    })
    return guides
  }, [exercise, drawings, storedGuides, shapes, settings, composition])

  // A cell keeps the guide it showed when its first stroke began: the stored
  // outlines are what the canvas and the font use from then on.
  useEffect(() => {
    const written = new Set(visibleStrokes(strokes).map((stroke) => cellIndexOf(stroke, grid, cellCount)))
    const next: Guides = {}
    for (const index of written) {
      const guide = cellGuides.get(index)
      if (guide && Object.keys(guide.roles).length) next[index] = guide
    }
    if (sameGuides(next, guidesRef.current)) return
    guidesRef.current = next
    setStoredGuides(next)
    projectActions.saveSessionGuides(exercise.id, next)
  }, [strokes, cellGuides, grid, cellCount, exercise.id])

  const save = (nextStrokes: readonly RawStroke[], confirmedBoundaries = boundariesRef.current, target: CanvasGrid = grid) => {
    const requestedBoundaries = holdBoundaries(confirmedBoundaries, holdsRef.current, nextStrokes, target, exercise, drawings)
    const assigned = assignStrokes(nextStrokes, target, exercise, drawings, requestedBoundaries)
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
