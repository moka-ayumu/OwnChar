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
import { assignStrokes, captureRecords, cellIndexOf, editableSlots, fixedSlots, reflowStrokes, validBoundaries, visibleStrokes, type CanvasGrid } from './stroke-assignment'

type Boundaries = Record<number, JamoBoundary[]>
type Guides = Record<number, StoredCellGuide>

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
  const boundariesRef = useRef(boundaries)
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

  const save = (nextStrokes: readonly RawStroke[], requestedBoundaries = boundariesRef.current, target: CanvasGrid = grid) => {
    const assigned = assignStrokes(nextStrokes, target, exercise, drawings, requestedBoundaries)
    if (JSON.stringify(assigned.boundaries) !== JSON.stringify(boundaries)) {
      if (countBoundaries(assigned.boundaries) < countBoundaries(requestedBoundaries)) setBoundaryWarning('경계로 지정한 획이 지워져 이후 자모 경계를 다시 확인해 주세요.')
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

  const setRequestedBoundaries = (next: Boundaries) => {
    setBoundaryWarning('')
    boundariesRef.current = next
    setBoundaries(next)
    save(strokes, next)
  }

  // The cell of the latest stroke is the one whose jamo boundaries can be set.
  const latest = visibleStrokes(strokes).at(-1)
  const activeCellIndex = latest ? cellIndexOf(latest, grid, cellCount) : null
  const activeCell = activeCellIndex === null ? null : exercise.cells[activeCellIndex]
  const activeStrokes = activeCellIndex === null ? [] : visibleStrokes(strokes).filter((stroke) => cellIndexOf(stroke, grid, cellCount) === activeCellIndex)
  const activeSlots = activeCell && activeCellIndex !== null ? editableSlots(activeCell, activeCellIndex, exercise, drawings) : []
  const activeBoundaries = activeCellIndex === null ? [] : validBoundaries(activeStrokes, activeSlots, boundaries[activeCellIndex] ?? [])
  const activeTarget = activeSlots[activeBoundaries.length]
  const lastBoundaryStroke = activeBoundaries.length ? activeStrokes.findIndex((stroke) => stroke.id === activeBoundaries.at(-1)!.afterElementId) : -1
  const canCompleteTarget = Boolean(activeTarget && activeStrokes.length > lastBoundaryStroke + 1)

  return {
    grid,
    rowCount: Math.ceil(cellCount / columns),
    strokes,
    capture,
    cellGuides,
    boundaryWarning,
    /** The cell size can change only while nothing is written. */
    setCellSize,
    save,
    clear() {
      boundariesRef.current = {}
      setBoundaries({})
      setBoundaryWarning('')
      save([], {})
    },
    /** Switches to another sentence, as it was last saved. */
    open(next: WritingExercise) {
      const session = sessions[next.id] as WritingSessionRecord | undefined
      lastRevision.current = ''
      setStrokes(session?.elements ?? [])
      boundariesRef.current = session?.boundaries ?? {}
      setBoundaries(boundariesRef.current)
      setBoundaryWarning('')
      guidesRef.current = session?.guides ?? {}
      setStoredGuides(guidesRef.current)
      setCellSize(session?.cellSize ?? REFERENCE_CELL_SIZE)
      setColumns(session?.columns ?? Math.min(6, next.cells.length))
    },
    active: { cell: activeCell, target: activeTarget, hasBoundaries: activeBoundaries.length > 0, canComplete: canCompleteTarget },
    /** Declares the jamo being written finished after the latest stroke. */
    completeActiveTarget(confirmedAt: number) {
      if (!canCompleteTarget || activeCellIndex === null || !activeTarget) return
      setRequestedBoundaries({
        ...boundaries,
        [activeCellIndex]: [...activeBoundaries, {
          slotIndex: activeTarget.slotIndex,
          promptId: activeTarget.slot.promptId,
          afterElementId: activeStrokes.at(-1)!.id,
          confirmedAt,
        }],
      })
    },
    undoActiveBoundary() {
      if (activeCellIndex === null || !activeBoundaries.length) return
      const next = { ...boundaries }
      if (activeBoundaries.length > 1) next[activeCellIndex] = activeBoundaries.slice(0, -1)
      else delete next[activeCellIndex]
      setRequestedBoundaries(next)
    },
  }
}
