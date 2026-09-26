import { getStroke } from 'perfect-freehand'
import { EndType, FillRule, JoinType, inflatePaths, union } from 'clipper2-ts'
import { stabilizeStroke, type ConditionedStroke, type StabilizeMode } from './stroke-stabilizer'

export interface RawStroke {
  id: string
  type: 'freedraw'
  x: number
  y: number
  width: number
  height: number
  points: [number, number][]
  pressures: number[]
  strokeWidth: number
  version: number
  isDeleted?: boolean
  simulatePressure: false
  lastCommittedPoint?: [number, number] | null
}

export const REFERENCE_CELL_SIZE = 148
export const STROKE_SIZE_FACTOR = 4.25

type Point = [number, number]

export type { ConditionedStroke }

/** `live-start` is the legacy name of `live`. */
export type StrokeConditionMode = StabilizeMode | 'live-start'

export function conditionStroke(
  points: readonly [number, number][],
  pressures: readonly number[],
  diameter: number,
  mode: StrokeConditionMode,
  strength = 1,
): ConditionedStroke {
  return stabilizeStroke(points, pressures, diameter, mode === 'complete' ? 'complete' : 'live', strength)
}

export function stabilizeStrokePoints(points: readonly Point[], diameter: number, complete = true, strength = 1) {
  return conditionStroke(points, points.map(() => 1), diameter, complete ? 'complete' : 'live-start', strength).points
}

export function pressureResponse(pressure: number): number {
  const x = Math.max(0, Math.min(1, Number.isFinite(pressure) ? pressure : 1))
  if (x >= 0.1) return 1
  const t = x / 0.1
  return 3 * t * t - 2 * t * t * t
}

export function strokePolygon(
  points: readonly [number, number][],
  pressures: readonly number[],
  size: number,
  complete = true,
  strength = 1,
  conditionSize = size,
): [number, number][] {
  if (!points.length) return []
  // The centerline is conditioned at the pen size it was written with, so a
  // glyph rendered at another outline size keeps the exact captured path.
  const conditioned = conditionStroke(points, pressures, conditionSize, complete ? 'complete' : 'live', strength)
  const input = conditioned.points.map(([x, y], index) => {
    let pressure = conditioned.pressures[index]
    if ((index === 0 || index === points.length - 1) && pressure < 0.1) {
      const neighbor = index === 0 ? pressures.find((value) => value > 0) : [...pressures].reverse().find((value) => value > 0)
      pressure = Math.max(0.1, neighbor ?? 0.1)
    }
    return [x, y, pressure]
  }).filter((point, index, all) => index === 0 || Math.hypot(point[0] - all[index - 1][0], point[1] - all[index - 1][1]) > 1e-3)
  // The stabilizer already removed hand jitter; a strong streamline on top of
  // it would only lag behind the pen and round off intentional corners.
  const amount = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1))
  return getStroke(input, {
    size,
    thinning: 1,
    smoothing: 0.1,
    streamline: 0.5 - 0.35 * amount,
    last: complete,
    simulatePressure: false,
    easing: pressureResponse,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  }) as [number, number][]
}

export function strokeContours(points: readonly [number, number][], pressures: readonly number[], size: number, complete = true, strength = 1, conditionSize = size): [number, number][][] {
  const precision = 1024
  const closedCenterline = points.length > 2 && Math.hypot(
    points[0][0] - points.at(-1)![0],
    points[0][1] - points.at(-1)![1],
  ) <= Math.max(0.25, conditionSize * 0.2)
  if (closedCenterline) {
    const conditioned = conditionStroke(points, pressures, conditionSize, 'complete', strength).points
    const centerline = conditioned.slice(0, -1).map(([x, y]) => ({ x: Math.round(x * precision), y: Math.round(y * precision) }))
    return inflatePaths([centerline], size * precision / 2, JoinType.Round, EndType.Joined)
      .filter((contour) => contour.length >= 3)
      .map((contour) => contour.map(({ x, y }) => [x / precision, y / precision] as [number, number]))
  }
  const polygon = strokePolygon(points, pressures, size, complete, strength, conditionSize)
  if (polygon.length < 3) return polygon.length ? [polygon] : []
  const subject = [polygon.map(([x, y]) => ({ x: Math.round(x * precision), y: Math.round(y * precision) }))]
  return union(subject, [], FillRule.NonZero)
    .filter((contour) => contour.length >= 3)
    .map((contour) => contour.map(({ x, y }) => [x / precision, y / precision] as [number, number]))
}

function polygonCrossesItself(polygon: readonly [number, number][]) {
  const cross = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  for (let first = 0; first < polygon.length; first += 1) {
    const a = polygon[first]; const b = polygon[(first + 1) % polygon.length]
    for (let second = first + 2; second < polygon.length; second += 1) {
      if (first === 0 && second === polygon.length - 1) continue
      const c = polygon[second]; const d = polygon[(second + 1) % polygon.length]
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true
    }
  }
  return false
}

export function strokeNeedsUnion(points: readonly [number, number][], size: number, pressures: readonly number[] = [], strength = 1, conditionSize = size): boolean {
  if (points.length < 3) return false
  const first = points[0]
  const last = points.at(-1)!
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= size * 2) return true
  if (points.length < 4) return polygonCrossesItself(strokePolygon(points, pressures, size, true, strength, conditionSize))
  const cross = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  for (let firstSegment = 0; firstSegment < points.length - 1; firstSegment += 1) {
    for (let secondSegment = firstSegment + 2; secondSegment < points.length - 1; secondSegment += 1) {
      const a = points[firstSegment]
      const b = points[firstSegment + 1]
      const c = points[secondSegment]
      const d = points[secondSegment + 1]
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true
    }
  }
  // A tight turn can make the expanded outline cross itself even when the
  // pen's centerline never crosses. CFF cannot safely keep that contour.
  return polygonCrossesItself(strokePolygon(points, pressures, size, true, strength, conditionSize))
}

export function polygonSvgPath(points: readonly [number, number][]): string {
  if (!points.length) return ''
  const p = (point: readonly number[]) => `${point[0].toFixed(2)} ${point[1].toFixed(2)}`
  const commands = [`M ${p(points[0])}`]
  for (let index = 1; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    commands.push(`Q ${p(points[index])} ${p([(points[index][0] + next[0]) / 2, (points[index][1] + next[1]) / 2])}`)
  }
  commands.push(`Q ${p(points[0])} ${p(points[0])} Z`)
  return commands.join(' ')
}

export function strokeSvgPath(stroke: RawStroke, cellSize: number, strength = 1): string {
  const size = stroke.strokeWidth * STROKE_SIZE_FACTOR * cellSize / REFERENCE_CELL_SIZE
  const complete = stroke.lastCommittedPoint !== null
  if (!strokeNeedsUnion(stroke.points, size, stroke.pressures, strength)) return polygonSvgPath(strokePolygon(stroke.points, stroke.pressures, size, complete, strength))
  return strokeContours(stroke.points, stroke.pressures, size, complete, strength)
    .map((contour) => `M ${contour.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`)
    .join(' ')
}
