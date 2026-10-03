import { describe, expect, test } from 'vitest'
import type { Point } from '@/font/geometry/path-ops'
import { outlineStroke, strokePolygon } from '@/font/stroke/outline'
import { stabilizeStroke } from '@/font/stroke/stabilizer'
import { line, ring } from './helpers'

const full = (points: Point[]) => points.map(() => 1)
const stabilized = (points: Point[], mode: 'live' | 'complete' = 'complete', strength = 1) => stabilizeStroke(points, full(points), 10, mode, strength).points
const ySpan = (points: Point[]) => Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y))

/** Nonzero winding number of (x, y) in a set of contours. */
function winding(contours: Point[][], x: number, y: number) {
  let result = 0
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index += 1) {
      const [ax, ay] = contour[index]
      const [bx, by] = contour[(index + 1) % contour.length]
      if (ay <= y && by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) result += 1
      if (ay > y && by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) result -= 1
    }
  }
  return result
}

describe('stroke stabilizer', () => {
  test('straightens the hooks at both ends without changing the captured points', () => {
    const points: Point[] = [[0, 4], [3, 1], [7, 0], [12, 0], [20, 0], [40, 0], [60, 0], [80, 0], [88, 0], [93, 0], [97, -1], [100, -4]]
    const snapshot = structuredClone(points)
    const result = stabilized(points)
    expect(points).toEqual(snapshot)
    expect(ySpan(result.slice(0, 4))).toBeLessThanOrEqual(ySpan(points.slice(0, 4)) * 0.25)
    expect(ySpan(result.slice(-4))).toBeLessThanOrEqual(ySpan(points.slice(-4)) * 0.25)
    expect(result[6]).toEqual(points[6])
  })

  test('removes a release curl without backtracking along the stroke', () => {
    // Diagonal stroke that curls back and wobbles as the pen lifts (the blob in a "7").
    const points: Point[] = [...line([0, 0], [80, 80]), [83, 82], [85, 81], [84, 78], [82, 77], [81, 79]]
    const result = stabilized(points)
    const along = result.map(([x, y]) => (x + y) * Math.SQRT1_2).slice(-12)
    for (let index = 1; index < along.length; index += 1) expect(along[index]).toBeGreaterThanOrEqual(along[index - 1] - 1e-6)
    for (const [x, y] of result.slice(-5)) expect(Math.abs(x - y) * Math.SQRT1_2).toBeLessThan(1.5)
  })

  test('keeps an intentional corner sharp and a curved end curved', () => {
    const corner: Point[] = [...line([0, 0], [100, 0]), ...line([100, 0], [100, 100]).slice(1)]
    const cornerIndex = corner.findIndex(([x, y]) => x === 100 && y === 0)
    const result = stabilized(corner)
    expect(Math.hypot(result[cornerIndex][0] - 100, result[cornerIndex][1])).toBeLessThanOrEqual(1)
    const incoming = [result[cornerIndex][0] - result[cornerIndex - 5][0], result[cornerIndex][1] - result[cornerIndex - 5][1]]
    const outgoing = [result[cornerIndex + 5][0] - result[cornerIndex][0], result[cornerIndex + 5][1] - result[cornerIndex][1]]
    const angle = Math.acos((incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / (Math.hypot(incoming[0], incoming[1]) * Math.hypot(outgoing[0], outgoing[1])))
    expect(angle * 180 / Math.PI).toBeGreaterThanOrEqual(80)

    const curve: Point[] = [[20, 0], [12, 1], [6, 5], [2, 12], [0, 20], [2, 28], [6, 35], [12, 39], [20, 40]]
    expect(stabilizeStroke(curve, full(curve), 5, 'complete', 1).points).toEqual(curve)
  })

  test('smooths jitter in proportion to its strength and does nothing at zero', () => {
    const jitter = line([0, 0], [200, 0]).map(([x], index) => [x, index % 2 ? 1 : -1] as Point)
    const rms = (values: Point[]) => Math.sqrt(values.slice(15, -15).reduce((sum, [, y]) => sum + y * y, 0) / (values.length - 30))
    expect(rms(stabilized(jitter))).toBeLessThanOrEqual(rms(jitter) * 0.5)
    expect(stabilized(jitter, 'complete', 0)).toEqual(jitter)

    const hooked: Point[] = [[0, 2], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0]]
    const half = stabilizeStroke(hooked, full(hooked), 5, 'complete', 0.5).points
    const whole = stabilizeStroke(hooked, full(hooked), 5, 'complete', 1).points
    expect(half[0][1] - hooked[0][1]).toBeCloseTo((whole[0][1] - hooked[0][1]) / 2, 6)
  })

  test('while a stroke is still being drawn, leaves its tail under the pen and keeps its start steady', () => {
    const points: Point[] = [[0, 3], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0], [60, 0], [70, 8]]
    const early = stabilizeStroke(points.slice(0, 6), full(points.slice(0, 6)), 5, 'live', 1).points
    const later = stabilizeStroke(points, full(points), 5, 'live', 1).points
    expect(later.at(-1)).toEqual(points.at(-1))
    expect(Math.hypot(early[0][0] - later[0][0], early[0][1] - later[0][1])).toBeLessThan(0.25)
  })

  test('lifts the near-zero pressure samples of a pen release without changing the captured pressures', () => {
    const points: Point[] = [[0, 0], [10, 0], [20, 0], [30, 0], [45, 0], [48, 0], [50, 0]]
    const pressures = [1, 1, 1, 1, 0.03, 0.02, 0]
    const snapshot = [...pressures]
    const result = stabilizeStroke(points, pressures, 5, 'complete', 1)
    expect(pressures).toEqual(snapshot)
    expect(result.pressures.at(-1)).toBeGreaterThan(0.09)
    expect(result.pressures.at(-2)).toBeGreaterThan(pressures.at(-2)!)
  })
})

describe('stroke outline', () => {
  test('keeps the pen width whatever the pressure above the contact threshold, with round caps at zero pressure', () => {
    const centerline: Point[] = [[0, 0], [100, 0]]
    expect(ySpan(strokePolygon(centerline, [0.5, 0.5], 10))).toBeCloseTo(ySpan(strokePolygon(centerline, [1, 1], 10)), 3)

    const polygon = strokePolygon([[0, 0], [20, 0], [40, 0]], [0, 1, 0], 10)
    expect(ySpan(polygon.filter(([x]) => x <= 0.5))).toBeGreaterThan(8)
    expect(ySpan(polygon.filter(([x]) => x >= 39.5))).toBeGreaterThan(8)
  })

  test('a closed stroke becomes a ring: its seam is filled and its counter stays open', () => {
    const outline = outlineStroke(ring, full(ring), 10)
    expect(outline.smooth).toBe(false)
    expect(winding(outline.contours, 0, -20)).not.toBe(0)
    expect(winding(outline.contours, 0, 0)).toBe(0)
  })

  test('merges the outline of a tight turn whose widened sides cross, and leaves a plain stroke as one polygon', () => {
    // The centerline itself never crosses, and its ends are far apart.
    const turn: Point[] = [[0, 0], [40, 0], [40, 8], [20, 8]]
    const merged = outlineStroke(turn, full(turn), 10)
    expect(merged.smooth).toBe(false)
    expect(merged.contours.length).toBeGreaterThan(0)

    const plain = outlineStroke([[0, 0], [60, 0]], [1, 1], 10)
    expect(plain.smooth).toBe(true)
    expect(plain.contours).toHaveLength(1)
  })
})
