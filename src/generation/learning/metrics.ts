import type { WritingSessionRecord } from '@/collection/records'
import { clamp } from '@/font/geometry/path-ops'
import { DEFAULT_HANGUL_HEIGHT, medianHeight } from '@/font/metrics'
import { penDiameter, strokePolygon } from '@/font/stroke/outline'
import { completedHangulCells } from './samples'

/** The ink height and vertical centre the writer gives a whole syllable, in font units. */
export function learnHangulMetrics(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1) {
  const heights: number[] = []
  const centers: number[] = []
  for (const { session, assigned, cellY } of completedHangulCells(sessions)) {
    const ys = assigned.flat().flatMap((stroke) => strokePolygon(
      stroke.points.map(([x, y]) => [stroke.x + x, stroke.y + y]),
      stroke.pressures,
      penDiameter(stroke.strokeWidth, session.cellSize),
      true,
      endpointStabilization,
    )).map((point) => point[1])
    if (!ys.length) continue
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    const height = (bottom - top) * 1000 / session.cellSize
    if (height > 200 && height < 1000) {
      heights.push(height)
      centers.push(1000 - ((bottom + top) / 2 - cellY) * 1000 / session.cellSize)
    }
  }
  return {
    hangulTargetHeight: clamp(medianHeight(heights, DEFAULT_HANGUL_HEIGHT), 520, 850),
    hangulTargetCenter: clamp(medianHeight(centers, 500), 350, 650),
  }
}
