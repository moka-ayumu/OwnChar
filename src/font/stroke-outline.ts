import { getStroke } from 'perfect-freehand'
import { EndType, FillRule, JoinType, inflatePaths, union } from 'clipper2-ts'

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

function arcLengths(points: readonly Point[]) {
  const lengths = [0]
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]))
  }
  return lengths
}

function pointAtDistance(points: readonly Point[], lengths: readonly number[], distance: number): Point {
  const target = Math.max(0, Math.min(lengths.at(-1) ?? 0, distance))
  let right = 1
  while (right < lengths.length && lengths[right] < target) right += 1
  if (right >= lengths.length) return [...points.at(-1)!]
  const left = right - 1
  const span = lengths[right] - lengths[left]
  const t = span > 0 ? (target - lengths[left]) / span : 0
  return [
    points[left][0] + (points[right][0] - points[left][0]) * t,
    points[left][1] + (points[right][1] - points[left][1]) * t,
  ]
}

function valueAtDistance(values: readonly number[], lengths: readonly number[], distance: number) {
  const target = Math.max(0, Math.min(lengths.at(-1) ?? 0, distance))
  let right = 1
  while (right < lengths.length && lengths[right] < target) right += 1
  if (right >= lengths.length) return values.at(-1) ?? 1
  const left = right - 1
  const span = lengths[right] - lengths[left]
  const t = span > 0 ? (target - lengths[left]) / span : 0
  return (values[left] ?? 1) + ((values[right] ?? values[left] ?? 1) - (values[left] ?? 1)) * t
}

function normalized(vector: Point): Point | null {
  const length = Math.hypot(vector[0], vector[1])
  return length > 1e-4 ? [vector[0] / length, vector[1] / length] : null
}

function smoothstep(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

export interface ConditionedStroke {
  points: Point[]
  pressures: number[]
  closed: boolean
}

export type StrokeConditionMode = 'live-start' | 'complete'

/** Correct only lateral noise on a locally straight endpoint. */
export function conditionStroke(
  points: readonly [number, number][],
  pressures: readonly number[],
  diameter: number,
  mode: StrokeConditionMode,
  strength = 1,
): ConditionedStroke {
  const result = points.map(([x, y]) => [x, y] as [number, number])
  const resultPressures = points.map((_, index) => Number.isFinite(pressures[index]) ? pressures[index] : 1)
  if (points.length < 2 || diameter <= 0) return { points: result, pressures: resultPressures, closed: false }

  const distances = arcLengths(points)
  const total = distances.at(-1) ?? 0
  const closed = Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) <= diameter * 2
  const amount = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1))
  if (!amount || total < diameter * 4 || closed) return { points: result, pressures: resultPressures, closed }
  const windowLength = Math.min(total * 0.12, diameter * 1.5)

  const stabilizeEnd = (start: boolean) => {
    const endpointDistance = start ? 0 : total
    const sample = (fromEndpoint: number) => pointAtDistance(points, distances, start ? fromEndpoint : total - fromEndpoint)
    const support = Array.from({ length: 8 }, (_, index) => sample(diameter * (1 + index * 2 / 7)))
    const supportDirection = normalized([
      support.at(-1)![0] - support[0][0], support.at(-1)![1] - support[0][1],
    ])
    if (!supportDirection) return
    let tangent: Point = supportDirection
    const expected: Point = start
      ? [points[Math.min(1, points.length - 1)][0] - points[0][0], points[Math.min(1, points.length - 1)][1] - points[0][1]]
      : [points.at(-1)![0] - points[Math.max(0, points.length - 2)][0], points.at(-1)![1] - points[Math.max(0, points.length - 2)][1]]
    if (tangent[0] * expected[0] + tangent[1] * expected[1] < 0) tangent = [-tangent[0], -tangent[1]]

    // Judge the stable support behind the contact/release region. Measuring the
    // noisy endpoint itself would reject exactly the straight strokes that need
    // conditioning.
    const linearitySamples = support
    const chord = Math.hypot(
      linearitySamples.at(-1)![0] - linearitySamples[0][0],
      linearitySamples.at(-1)![1] - linearitySamples[0][1],
    )
    const supportArc = arcLengths(linearitySamples).at(-1) ?? 0
    if (chord / Math.max(supportArc, 1e-6) < 0.92) return
    const directions = support.slice(1).map((point, index) => normalized([
      point[0] - support[index][0], point[1] - support[index][1],
    ])).filter((direction): direction is Point => Boolean(direction))
    let directionChange = 0
    for (let index = 1; index < directions.length; index += 1) {
      directionChange += Math.acos(Math.max(-1, Math.min(1,
        directions[index - 1][0] * directions[index][0] + directions[index - 1][1] * directions[index][1],
      )))
    }
    if (directionChange > 25 * Math.PI / 180) return

    const normal: Point = [-tangent[1], tangent[0]]
    const normalOffsets = support.map((point) => point[0] * normal[0] + point[1] * normal[1]).sort((a, b) => a - b)
    const normalOffset = normalOffsets[Math.floor(normalOffsets.length / 2)]
    const supportPressures = Array.from({ length: 8 }, (_, index) => valueAtDistance(
      resultPressures,
      distances,
      start ? diameter * (1 + index * 2 / 7) : total - diameter * (1 + index * 2 / 7),
    )).sort((a, b) => a - b)
    const stablePressure = Math.max(0.1, supportPressures[Math.floor(supportPressures.length / 2)] ?? 1)

    points.forEach((point, index) => {
      const fromEndpoint = Math.abs(distances[index] - endpointDistance)
      if (fromEndpoint > windowLength) return
      const currentOffset = point[0] * normal[0] + point[1] * normal[1]
      const correction = Math.max(-diameter * 0.4, Math.min(diameter * 0.4, normalOffset - currentOffset))
      const weight = smoothstep(1 - fromEndpoint / windowLength) * amount
      result[index] = [
        point[0] + normal[0] * correction * weight,
        point[1] + normal[1] * correction * weight,
      ]
      // Pen hardware commonly emits a few near-zero samples immediately after
      // contact and before release. Leaving those between a full-width body and
      // the forced round cap creates a visible pinched neck / detached dot.
      if (resultPressures[index] < 0.1) {
        resultPressures[index] += (stablePressure - resultPressures[index]) * weight
      }
    })
  }

  stabilizeEnd(true)
  if (mode === 'complete') stabilizeEnd(false)
  return { points: result, pressures: resultPressures, closed }
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
): [number, number][] {
  if (!points.length) return []
  const conditioned = conditionStroke(points, pressures, size, complete ? 'complete' : 'live-start', strength)
  const input = conditioned.points.map(([x, y], index) => {
    let pressure = conditioned.pressures[index]
    if ((index === 0 || index === points.length - 1) && pressure < 0.1) {
      const neighbor = index === 0 ? pressures.find((value) => value > 0) : [...pressures].reverse().find((value) => value > 0)
      pressure = Math.max(0.1, neighbor ?? 0.1)
    }
    return [x, y, pressure]
  })
  return getStroke(input, {
    size,
    thinning: 1,
    smoothing: 0.1,
    streamline: 0.5,
    last: complete,
    simulatePressure: false,
    easing: pressureResponse,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  }) as [number, number][]
}

export function strokeContours(points: readonly [number, number][], pressures: readonly number[], size: number, complete = true, strength = 1): [number, number][][] {
  const precision = 1024
  const closedCenterline = points.length > 2 && Math.hypot(
    points[0][0] - points.at(-1)![0],
    points[0][1] - points.at(-1)![1],
  ) <= Math.max(0.25, size * 0.2)
  if (closedCenterline) {
    const conditioned = conditionStroke(points, pressures, size, 'complete', strength).points
    const centerline = conditioned.slice(0, -1).map(([x, y]) => ({ x: Math.round(x * precision), y: Math.round(y * precision) }))
    return inflatePaths([centerline], size * precision / 2, JoinType.Round, EndType.Joined)
      .filter((contour) => contour.length >= 3)
      .map((contour) => contour.map(({ x, y }) => [x / precision, y / precision] as [number, number]))
  }
  const polygon = strokePolygon(points, pressures, size, complete, strength)
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

export function strokeNeedsUnion(points: readonly [number, number][], size: number, pressures: readonly number[] = [], strength = 1): boolean {
  if (points.length < 3) return false
  const first = points[0]
  const last = points.at(-1)!
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= size * 2) return true
  if (points.length < 4) return polygonCrossesItself(strokePolygon(points, pressures, size, true, strength))
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
  return polygonCrossesItself(strokePolygon(points, pressures, size, true, strength))
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
