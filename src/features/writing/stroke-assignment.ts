import { isFixedSlot, type CaptureSlot, type WritingCell, type WritingExercise } from '@/collection/exercises'
import { cellOrigin, type DrawingRecord, type JamoBoundary, type StrokeAssignment, type StrokePath } from '@/collection/records'
import { strokeSvgPath, type RawStroke } from '@/font/stroke/outline'

/** The grid a sentence is written on. */
export interface CanvasGrid {
  cellSize: number
  columns: number
}

export interface IndexedSlot { slot: CaptureSlot; slotIndex: number }

/** The strokes captured for one slot of one cell. */
export interface CaptureGroup extends IndexedSlot {
  cellIndex: number
  strokes: RawStroke[]
}

export const visibleStrokes = (strokes: readonly RawStroke[]) => strokes.filter((stroke) => !stroke.isDeleted)

/** A stroke belongs to the cell it starts in, however far it runs. */
export function cellIndexOf(stroke: RawStroke, grid: CanvasGrid, cellCount: number) {
  const column = Math.max(0, Math.min(grid.columns - 1, Math.floor((stroke.x + stroke.points[0][0]) / grid.cellSize)))
  const row = Math.max(0, Math.floor((stroke.y + stroke.points[0][1]) / grid.cellSize))
  return Math.max(0, Math.min(cellCount - 1, row * grid.columns + column))
}

/** Moves every stroke with its cell when the grid is rewrapped to another column count. */
export function reflowStrokes(strokes: readonly RawStroke[], from: CanvasGrid, to: CanvasGrid, cellCount: number): RawStroke[] {
  return strokes.map((stroke) => {
    const index = cellIndexOf(stroke, from, cellCount)
    const before = cellOrigin(index, from.columns, from.cellSize)
    const after = cellOrigin(index, to.columns, to.cellSize)
    return { ...stroke, x: stroke.x + after.x - before.x, y: stroke.y + after.y - before.y, version: stroke.version + 1 }
  })
}

function strokesByCell(strokes: readonly RawStroke[], grid: CanvasGrid, cellCount: number) {
  const byCell = Array.from({ length: cellCount }, () => [] as RawStroke[])
  for (const stroke of visibleStrokes(strokes)) byCell[cellIndexOf(stroke, grid, cellCount)].push(stroke)
  return byCell
}

const indexedSlots = (cell: WritingCell): IndexedSlot[] => cell.slots.map((slot, slotIndex) => ({ slot, slotIndex }))

/** Slots of a cell whose jamo was already captured elsewhere and is shown as a guide. */
export function fixedSlots(cell: WritingCell, cellIndex: number, exercise: WritingExercise, drawings: Record<string, DrawingRecord>) {
  return indexedSlots(cell).filter(({ slot, slotIndex }) => isFixedSlot(slot.promptId, cellIndex, slotIndex, exercise, drawings))
}

/** Slots of a cell that are still written in it, in writing order. */
export function editableSlots(cell: WritingCell, cellIndex: number, exercise: WritingExercise, drawings: Record<string, DrawingRecord>) {
  return indexedSlots(cell).filter(({ slot, slotIndex }) => !isFixedSlot(slot.promptId, cellIndex, slotIndex, exercise, drawings))
}

/** The leading boundaries that still match the cell: each ends its slot, in order, on a stroke that exists. */
export function validBoundaries(strokes: RawStroke[], slots: IndexedSlot[], boundaries: JamoBoundary[]) {
  const result: JamoBoundary[] = []
  let previousIndex = -1
  for (const boundary of boundaries) {
    const target = slots[result.length]
    const strokeIndex = strokes.findIndex((stroke) => stroke.id === boundary.afterElementId)
    if (!target || boundary.slotIndex !== target.slotIndex || boundary.promptId !== target.slot.promptId || strokeIndex <= previousIndex) break
    result.push(boundary)
    previousIndex = strokeIndex
  }
  return result
}

/**
 * Splits the strokes of every cell among its editable slots. A slot ends at
 * its confirmed boundary; without one it takes the stroke count its jamo is
 * usually written with, and the last slot takes whatever remains.
 */
export function assignStrokes(strokes: readonly RawStroke[], grid: CanvasGrid, exercise: WritingExercise, drawings: Record<string, DrawingRecord>, requestedBoundaries: Record<number, JamoBoundary[]>) {
  const byCell = strokesByCell(strokes, grid, exercise.cells.length)
  const groups: CaptureGroup[] = []
  const assignments: StrokeAssignment[] = []
  const boundaries: Record<number, JamoBoundary[]> = {}
  exercise.cells.forEach((cell, cellIndex) => {
    const cellStrokes = byCell[cellIndex]
    const slots = editableSlots(cell, cellIndex, exercise, drawings)
    const confirmed = validBoundaries(cellStrokes, slots, requestedBoundaries[cellIndex] ?? [])
    if (confirmed.length) boundaries[cellIndex] = confirmed
    let cursor = 0
    slots.forEach(({ slot, slotIndex }, index) => {
      const boundary = confirmed[index]
      const boundaryEnd = boundary ? cellStrokes.findIndex((stroke) => stroke.id === boundary.afterElementId) + 1 : -1
      const end = boundaryEnd > cursor ? boundaryEnd : index === slots.length - 1 ? cellStrokes.length : Math.min(cellStrokes.length, cursor + slot.expectedStrokes)
      const assigned = cellStrokes.slice(cursor, end)
      cursor = end
      groups.push({ cellIndex, slotIndex, slot, strokes: assigned })
      for (const stroke of assigned) assignments.push({ elementId: stroke.id, cellIndex, slotIndex, promptId: slot.promptId })
    })
  })
  return { groups, assignments, boundaries }
}

/** Display outlines of a slot's strokes, positioned inside their cell. */
export function strokePaths(group: CaptureGroup, grid: CanvasGrid, endpointStabilization: number): StrokePath[] {
  const origin = cellOrigin(group.cellIndex, grid.columns, grid.cellSize)
  return group.strokes.map((stroke) => ({
    d: strokeSvgPath(stroke, grid.cellSize, endpointStabilization),
    x: stroke.x - origin.x,
    y: stroke.y - origin.y,
    width: stroke.width,
    height: stroke.height,
  }))
}

export function previewSvg(paths: StrokePath[]) {
  if (!paths.length) return ''
  const minX = Math.min(...paths.map((path) => path.x))
  const minY = Math.min(...paths.map((path) => path.y))
  const maxX = Math.max(...paths.map((path) => path.x + Math.max(path.width, 1)))
  const maxY = Math.max(...paths.map((path) => path.y + Math.max(path.height, 1)))
  const body = paths.map((path) => `<path d="${path.d}" transform="translate(${path.x} ${path.y})" fill="#101114" fill-rule="nonzero"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}">${body}</svg>`
}

/** The drawing saved for each slot that has strokes. */
export function captureRecords(groups: CaptureGroup[], grid: CanvasGrid, exerciseId: string, endpointStabilization: number): DrawingRecord[] {
  return groups.filter((group) => group.strokes.length).map((group) => {
    const paths = strokePaths(group, grid, endpointStabilization)
    return {
      promptId: group.slot.promptId,
      codePoint: group.slot.char.codePointAt(0)!,
      elements: structuredClone(group.strokes),
      paths,
      previewSvg: previewSvg(paths),
      updatedAt: Date.now(),
      capture: { exerciseId, cellIndex: group.cellIndex, slotIndex: group.slotIndex },
    }
  })
}

/** How far one editable slot of a cell has come. */
export interface SlotProgress extends IndexedSlot {
  count: number
  /** Closed: it has its confirmed boundary or its usual stroke count, and is not held open. */
  done: boolean
}

/**
 * The editable slots of a cell with what each has collected. `held` is the
 * slot the writer keeps open (see `holdBoundaries`), which is never done.
 */
export function cellProgress(cellIndex: number, groups: CaptureGroup[], boundaries: Record<number, JamoBoundary[]>, held?: number): SlotProgress[] {
  const confirmed = boundaries[cellIndex]?.length ?? 0
  return groups.filter((group) => group.cellIndex === cellIndex).map(({ slot, slotIndex, strokes }, index) => ({
    slot, slotIndex, count: strokes.length,
    done: index !== held && strokes.length > 0 && (index < confirmed || strokes.length >= slot.expectedStrokes),
  }))
}

/**
 * Whether each cell of the sentence is finished: every jamo it collects is
 * done. A cell that collects nothing (a space, a jamo fixed elsewhere) is
 * finished once the writer has moved on to a later cell; at the end of the
 * sentence, where no later cell collects anything, it is finished with the
 * rest of the sentence.
 */
export function completedCells(strokes: readonly RawStroke[], grid: CanvasGrid, exercise: WritingExercise, groups: CaptureGroup[], boundaries: Record<number, JamoBoundary[]>, holds: Record<number, number>) {
  const lastWritten = Math.max(-1, ...visibleStrokes(strokes).map((stroke) => cellIndexOf(stroke, grid, exercise.cells.length)))
  const progress = exercise.cells.map((_, cellIndex) => cellProgress(cellIndex, groups, boundaries, holds[cellIndex]))
  const lastCollecting = progress.reduce((last, slots, cellIndex) => slots.length ? cellIndex : last, -1)
  const collected = progress.map((slots, cellIndex) => slots.every((slot) => slot.done) || (cellIndex < lastWritten && holds[cellIndex] === undefined && slots.every((slot) => slot.count > 0)))
  const allCollected = collected.every(Boolean)
  return progress.map((slots, cellIndex) => {
    if (slots.length) return collected[cellIndex]
    return cellIndex < lastWritten || (cellIndex > lastCollecting && allCollected)
  })
}

/**
 * Boundaries that close the first `count` slots of a cell where its strokes
 * divide now: a confirmed boundary stays, any other ends on the last stroke
 * its slot was given. Null when one of those slots has no stroke to end on.
 */
export function boundariesThrough(cellIndex: number, count: number, groups: CaptureGroup[], confirmed: JamoBoundary[], confirmedAt: number): JamoBoundary[] | null {
  const cellGroups = groups.filter((group) => group.cellIndex === cellIndex)
  const result: JamoBoundary[] = []
  for (let index = 0; index < count; index += 1) {
    const group = cellGroups[index]
    const last = group?.strokes.at(-1)
    if (!last) return null
    result.push(confirmed[index] ?? { slotIndex: group.slotIndex, promptId: group.slot.promptId, afterElementId: last.id, confirmedAt })
  }
  return result
}

/**
 * `boundaries` with every held slot ending on the latest stroke of its cell,
 * so a slot the writer reopened keeps all that is written there until it is
 * released. `holds` maps a cell to the position of its held editable slot.
 */
export function holdBoundaries(boundaries: Record<number, JamoBoundary[]>, holds: Record<number, number>, strokes: readonly RawStroke[], grid: CanvasGrid, exercise: WritingExercise, drawings: Record<string, DrawingRecord>) {
  const entries = Object.entries(holds)
  if (!entries.length) return boundaries
  const byCell = strokesByCell(strokes, grid, exercise.cells.length)
  const next = { ...boundaries }
  for (const [key, held] of entries) {
    const cellIndex = Number(key)
    const cellStrokes = byCell[cellIndex]
    const slots = editableSlots(exercise.cells[cellIndex], cellIndex, exercise, drawings)
    const requested = boundaries[cellIndex] ?? []
    const before = validBoundaries(cellStrokes, slots, requested).slice(0, held)
    const target = slots[held]
    const latest = cellStrokes.at(-1)
    const open = before.length === held && target && latest && latest.id !== before.at(-1)?.afterElementId
    const closing = open ? [{ slotIndex: target.slotIndex, promptId: target.slot.promptId, afterElementId: latest.id, confirmedAt: requested[held]?.confirmedAt ?? Date.now() }] : []
    if (before.length + closing.length) next[cellIndex] = [...before, ...closing]
    else delete next[cellIndex]
  }
  return next
}
