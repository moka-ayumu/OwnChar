import type { WritingSessionRecord } from '@/types/project'
import { REFERENCE_CELL_SIZE, STROKE_SIZE_FACTOR, strokePolygon } from './stroke-outline'
import { completedHangulCells } from './hangul-samples'
import { DEFAULT_HANGUL_HEIGHT, medianHeight } from './size-normalization'

function completedSampleMetrics(sessions: Record<string, WritingSessionRecord>, endpointStabilization: number) {
  const heights: number[] = []
  const centers: number[] = []
  for (const { session, assigned, cellY } of completedHangulCells(sessions)) {
    const points = assigned.flat().flatMap((stroke) => strokePolygon(
      stroke.points.map(([x, y]) => [stroke.x + x, stroke.y + y]),
      stroke.pressures,
      stroke.strokeWidth * STROKE_SIZE_FACTOR * session.cellSize / REFERENCE_CELL_SIZE,
      true,
      endpointStabilization,
    ))
    if (!points.length) continue
    const height = (Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]))) * 1000 / session.cellSize
    if (height > 200 && height < 1000) {
      heights.push(height)
      const center = 1000 - ((Math.max(...points.map((point) => point[1])) + Math.min(...points.map((point) => point[1]))) / 2 - cellY) * 1000 / session.cellSize
      centers.push(center)
    }
  }
  return { heights, centers }
}

export function learnHangulHeight(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1) {
  return Math.max(520, Math.min(850, medianHeight(completedSampleMetrics(sessions, endpointStabilization).heights, DEFAULT_HANGUL_HEIGHT)))
}

export function learnHangulCenter(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1) {
  return Math.max(350, Math.min(650, medianHeight(completedSampleMetrics(sessions, endpointStabilization).centers, 500)))
}
