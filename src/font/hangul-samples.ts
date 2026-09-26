import { WRITING_EXERCISES, type WritingCell } from '@/lib/writing-exercises'
import type { WritingSessionRecord } from '@/types/project'
import type { RawStroke } from './stroke-outline'

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
    const strokes = new Map((session.elements as unknown as RawStroke[])
      .filter((item) => !item.isDeleted).map((item) => [item.id, item]))
    exercise.cells.forEach((cell, cellIndex) => {
      if (cell.slots.length < 2) return
      const assigned = cell.slots.map((_, slotIndex) => session.assignments
        .filter((assignment) => assignment.cellIndex === cellIndex && assignment.slotIndex === slotIndex)
        .map((assignment) => strokes.get(assignment.elementId))
        .filter((stroke): stroke is RawStroke => Boolean(stroke)))
      if (assigned.some((group, index) => group.length < cell.slots[index].expectedStrokes)) return
      result.push({
        cell, cellIndex, session, assigned,
        cellX: (cellIndex % session.columns) * session.cellSize,
        cellY: Math.floor(cellIndex / session.columns) * session.cellSize,
      })
    })
  }
  return result
}
