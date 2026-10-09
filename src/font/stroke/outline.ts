import { getStroke } from 'perfect-freehand'
import { EndType, FillRule, JoinType, inflatePaths, union } from 'clipper2-ts'
import type { Point } from '@/font/geometry/path-ops'
import { stabilizeStroke } from './stabilizer'

/** One pen stroke as captured: points are relative to (x, y), in canvas pixels. */
export interface RawStroke {
  id: string
  x: number
  y: number
  width: number
  height: number
  points: Point[]
  pressures: number[]
  strokeWidth: number
  version: number
  isDeleted?: boolean
  /** null while the stroke is still being drawn. */
  lastCommittedPoint?: Point | null
}

export interface StrokeOutline {
  contours: Point[][]
  /** A single perfect-freehand polygon, drawn with curves; merged contours are drawn with lines. */
  smooth: boolean
}

/**
 * What outlining a finished stroke works out that does not depend on the pen
 * size it is rendered at. Kept by the owner of a stroke that is outlined at
 * many sizes; the stroke must not change while it is in use.
 */
export interface StrokeMemo {
  conditioned?: ReturnType<typeof stabilizeStroke>
  centerlineCrosses?: boolean
}

export const REFERENCE_CELL_SIZE = 148
export const STROKE_SIZE_FACTOR = 4.25

/** Pen diameter in the pixels of a `cellSize` writing cell. */
export function penDiameter(strokeWidth: number, cellSize: number) {
  return strokeWidth * STROKE_SIZE_FACTOR * cellSize / REFERENCE_CELL_SIZE
}

function pressureResponse(pressure: number): number {
  const x = Math.max(0, Math.min(1, Number.isFinite(pressure) ? pressure : 1))
  if (x >= 0.1) return 1
  const t = x / 0.1
  return 3 * t * t - 2 * t * t * t
}

export function strokePolygon(
  points: readonly Point[],
  pressures: readonly number[],
  size: number,
  complete = true,
  strength = 1,
  conditionSize = size,
  memo?: StrokeMemo,
): Point[] {
  if (!points.length) return []
  // The centerline is conditioned at the pen size it was written with, so a
  // glyph rendered at another outline size keeps the exact captured path.
  const condition = () => stabilizeStroke(points, pressures, conditionSize, complete ? 'complete' : 'live', strength)
  const conditioned = memo && complete ? memo.conditioned ??= condition() : condition()
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
  }) as Point[]
}

const CLIPPER_PRECISION = 1024
const toClipper = (points: readonly Point[]) => points.map(([x, y]) => ({ x: Math.round(x * CLIPPER_PRECISION), y: Math.round(y * CLIPPER_PRECISION) }))
const fromClipper = (contours: Array<Array<{ x: number; y: number }>>) => contours
  .filter((contour) => contour.length >= 3)
  .map((contour) => contour.map(({ x, y }) => [x / CLIPPER_PRECISION, y / CLIPPER_PRECISION] as Point))

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
}

/** Whether two sides of a closed polygon that do not share a corner cross. */
function polygonCrossesItself(polygon: readonly Point[]) {
  const count = polygon.length
  if (count < 4) return false
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (const [x, y] of polygon) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  // Sides are bucketed on a grid, so each is only compared with the sides near it.
  const GRID = 32
  const size = Math.max(maxX - minX, maxY - minY, 1e-9) / GRID
  const cell = (value: number, origin: number) => Math.min(GRID - 1, Math.floor((value - origin) / size))
  const buckets: Array<number[] | undefined> = new Array(GRID * GRID)
  for (let side = 0; side < count; side += 1) {
    const a = polygon[side]; const b = polygon[(side + 1) % count]
    const x2 = cell(Math.max(a[0], b[0]), minX); const y2 = cell(Math.max(a[1], b[1]), minY)
    for (let x = cell(Math.min(a[0], b[0]), minX); x <= x2; x += 1) {
      for (let y = cell(Math.min(a[1], b[1]), minY); y <= y2; y += 1) {
        const bucket = buckets[x * GRID + y] ??= []
        for (const other of bucket) {
          if (side - other < 2 || (other === 0 && side === count - 1)) continue
          if (segmentsCross(polygon[other], polygon[other + 1], a, b)) return true
        }
        bucket.push(side)
      }
    }
  }
  return false
}

/**
 * A stroke that closes on itself, crosses itself, or turns so tightly that its
 * widened outline crosses itself cannot be kept as one polygon: CFF fills
 * even-odd, so the overlap would become a hole.
 */
function needsUnion(points: readonly Point[], size: number, polygon: () => Point[], memo?: StrokeMemo) {
  if (points.length < 3) return false
  const first = points[0]
  const last = points.at(-1)!
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= size * 2) return true
  if (memo ? memo.centerlineCrosses ??= centerlineCrosses(points) : centerlineCrosses(points)) return true
  return polygonCrossesItself(polygon())
}

function centerlineCrosses(points: readonly Point[]) {
  for (let firstSegment = 0; firstSegment < points.length - 1; firstSegment += 1) {
    for (let secondSegment = firstSegment + 2; secondSegment < points.length - 1; secondSegment += 1) {
      if (segmentsCross(points[firstSegment], points[firstSegment + 1], points[secondSegment], points[secondSegment + 1])) return true
    }
  }
  return false
}

/**
 * The filled outline of a pen stroke at pen diameter `size`. `conditionSize`
 * is the diameter the stroke was written with, when it is rendered at another.
 * `memo` carries what an earlier size of the same finished stroke worked out.
 */
export function outlineStroke(
  points: readonly Point[],
  pressures: readonly number[],
  size: number,
  complete = true,
  strength = 1,
  conditionSize = size,
  memo?: StrokeMemo,
): StrokeOutline {
  let settled: Point[] | undefined
  const settledPolygon = () => settled ??= strokePolygon(points, pressures, size, true, strength, conditionSize, memo)
  const polygon = () => complete ? settledPolygon() : strokePolygon(points, pressures, size, false, strength, conditionSize)
  if (!needsUnion(points, size, settledPolygon, memo)) return { contours: [polygon()], smooth: true }

  const closedCenterline = Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) <= Math.max(0.25, conditionSize * 0.2)
  if (closedCenterline) {
    // A ring keeps its counter: widen the closed centerline instead of merging a capped stroke.
    const centerline = (memo?.conditioned ?? stabilizeStroke(points, pressures, conditionSize, 'complete', strength)).points.slice(0, -1)
    return { contours: fromClipper(inflatePaths([toClipper(centerline)], size * CLIPPER_PRECISION / 2, JoinType.Round, EndType.Joined)), smooth: false }
  }
  const outline = polygon()
  if (outline.length < 3) return { contours: outline.length ? [outline] : [], smooth: false }
  return { contours: fromClipper(union([toClipper(outline)], [], FillRule.NonZero)), smooth: false }
}

function polygonSvgPath(points: readonly Point[]): string {
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

const svgPathCache = new WeakMap<RawStroke['points'], Map<string, string>>()

/** SVG path data of a stroke, relative to its own (x, y). Kept while the stroke's points stay the same array. */
export function strokeSvgPath(stroke: RawStroke, cellSize: number, strength = 1): string {
  const complete = stroke.lastCommittedPoint !== null
  const key = `${cellSize}|${stroke.strokeWidth}|${strength}|${complete}`
  let byKey = svgPathCache.get(stroke.points)
  if (!byKey) svgPathCache.set(stroke.points, byKey = new Map())
  const cached = byKey.get(key)
  if (cached !== undefined) return cached
  const outline = outlineStroke(stroke.points, stroke.pressures, penDiameter(stroke.strokeWidth, cellSize), complete, strength)
  const path = outline.smooth
    ? polygonSvgPath(outline.contours[0])
    : outline.contours.map((contour) => `M ${contour.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`).join(' ')
  byKey.set(key, path)
  return path
}
