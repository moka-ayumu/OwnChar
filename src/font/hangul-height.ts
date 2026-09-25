import { WRITING_EXERCISES } from '@/lib/writing-exercises'
import type { WritingSessionRecord } from '@/types/project'
import { REFERENCE_CELL_SIZE, STROKE_SIZE_FACTOR, strokePolygon, type RawStroke } from './stroke-outline'
import { DEFAULT_HANGUL_HEIGHT, medianHeight } from './size-normalization'

function completedSampleMetrics(sessions: Record<string, WritingSessionRecord>, endpointStabilization: number) {
  const heights: number[] = []
  const centers: number[] = []
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
      const points = assigned.flat().flatMap((stroke) => strokePolygon(
        stroke.points.map(([x, y]) => [stroke.x + x, stroke.y + y]),
        stroke.pressures,
        stroke.strokeWidth * STROKE_SIZE_FACTOR * session.cellSize / REFERENCE_CELL_SIZE,
        true,
        endpointStabilization,
      ))
      if (!points.length) return
      const height = (Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]))) * 1000 / session.cellSize
      if (height > 200 && height < 1000) {
        heights.push(height)
        const cellY = Math.floor(cellIndex / session.columns) * session.cellSize
        const center = 1000 - ((Math.max(...points.map((point) => point[1])) + Math.min(...points.map((point) => point[1]))) / 2 - cellY) * 1000 / session.cellSize
        centers.push(center)
      }
    })
  }
  return { heights, centers }
}

export function learnHangulHeight(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1) {
  return Math.max(520, Math.min(850, medianHeight(completedSampleMetrics(sessions, endpointStabilization).heights, DEFAULT_HANGUL_HEIGHT)))
}

export function learnHangulCenter(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1) {
  return Math.max(350, Math.min(650, medianHeight(completedSampleMetrics(sessions, endpointStabilization).centers, 500)))
}
