import { WRITING_EXERCISES, type WritingCell } from '@/collection/exercises'
import { cellOrigin, type WritingSessionRecord } from '@/collection/records'
import type { RawStroke } from '@/font/stroke/outline'

export interface CompletedHangulCell {
  cell: WritingCell
  cellIndex: number
  session: WritingSessionRecord
  /** Strokes per capture slot, in canvas coordinates. */
  assigned: RawStroke[][]
  cellX: number
  cellY: number
}

/**
 * Every fully written syllable of the base Hangul sentences. A partly written
 * syllable must never teach spacing, size or proportion.
 */
export function completedHangulCells(sessions: Record<string, WritingSessionRecord>): CompletedHangulCell[] {
  const result: CompletedHangulCell[] = []
  for (const exercise of WRITING_EXERCISES) {
    if (exercise.group !== 'hangul') continue
    const session = sessions[exercise.id]
    if (!session) continue
    const strokes = new Map(session.elements.filter((item) => !item.isDeleted).map((item) => [item.id, item]))
    exercise.cells.forEach((cell, cellIndex) => {
      if (cell.slots.length < 2) return
      const assigned = cell.slots.map((_, slotIndex) => session.assignments
        .filter((assignment) => assignment.cellIndex === cellIndex && assignment.slotIndex === slotIndex)
        .map((assignment) => strokes.get(assignment.elementId))
        .filter((stroke): stroke is RawStroke => Boolean(stroke)))
      if (assigned.some((group, index) => group.length < cell.slots[index].expectedStrokes)) return
      const origin = cellOrigin(cellIndex, session.columns, session.cellSize)
      result.push({ cell, cellIndex, session, assigned, cellX: origin.x, cellY: origin.y })
    })
  }
  return result
}

/** Mean without the outer tenth on each side, once there are enough samples to have outliers. */
export function trimmedMean(values: number[]) {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0
  const retained = sorted.slice(trim, sorted.length - trim)
  return retained.reduce((sum, value) => sum + value, 0) / retained.length
}

/** Appends `value` to the list kept under `key`. */
export function collect<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
