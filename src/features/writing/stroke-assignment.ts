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
