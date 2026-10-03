import type { NormalizedShape } from './shape'

/** Where the ink of a shape sits across its width, measured along its pen paths. */
export interface InkBalance {
  /** Offset of the mean ink position from the middle of the pen paths' extent, in cell fractions. */
  mean: number
  /** The same for the middle of the span holding the central 80% of the ink: a thin protrusion does not widen it. */
  core: number
  /** Width of that span, in cell fractions. */
  span: number
  /** Total length of the pen paths, in cell fractions. */
  length: number
}

const BINS = 64
const balances = new WeakMap<NormalizedShape, InkBalance>()

/**
 * Horizontal ink balance of a shape. Ink is counted as pen-path length times
 * pen width, so overlapping strokes are not merged and nothing is rasterized.
 * Offsets scale with the shape and do not change when it is moved.
 */
export function inkBalance(shape: NormalizedShape): InkBalance {
  const cached = balances.get(shape)
  if (cached) return cached
  // [from, to, weight, length] of every pen-path segment, in cell fractions.
  const segments: Array<[number, number, number, number]> = []
  for (const { centerline } of shape.strokes) {
    const { points, diameter, cellSize } = centerline
    const pen = diameter / cellSize
    // A dot is as long as the pen is wide.
    if (points.length === 1) segments.push([points[0][0] / cellSize, points[0][0] / cellSize, pen * pen, pen])
    for (let index = 1; index < points.length; index += 1) {
      const length = Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]) / cellSize
      if (length > 0) segments.push([points[index - 1][0] / cellSize, points[index][0] / cellSize, length * pen, length])
    }
  }
  const total = segments.reduce((sum, segment) => sum + segment[2], 0)
  const length = segments.reduce((sum, segment) => sum + segment[3], 0)
  const left = Math.min(...segments.flatMap(([from, to]) => [from, to]))
  const width = Math.max(...segments.flatMap(([from, to]) => [from, to])) - left
  let balance: InkBalance = { mean: 0, core: 0, span: 0, length }
  if (total > 0 && width > 0) {
    const mean = segments.reduce((sum, [from, to, weight]) => sum + (from + to) / 2 * weight, 0) / total
    // Each segment spreads its ink evenly over the columns it crosses.
    const columns = new Array<number>(BINS).fill(0)
    const column = (x: number) => Math.min(BINS - 1, Math.floor((x - left) / width * BINS))
    for (const [from, to, weight] of segments) {
      const first = column(Math.min(from, to)); const last = column(Math.max(from, to))
      for (let index = first; index <= last; index += 1) columns[index] += weight / (last - first + 1)
    }
    const quantile = (share: number) => {
      let passed = 0; let index = 0
      while (index < BINS - 1 && passed + columns[index] < total * share) { passed += columns[index]; index += 1 }
      return left + (index + (columns[index] > 0 ? (total * share - passed) / columns[index] : 0.5)) * width / BINS
    }
    balance = { mean: mean - (left + width / 2), core: (quantile(0.1) + quantile(0.9)) / 2 - (left + width / 2), span: quantile(0.9) - quantile(0.1), length }
  }
  balances.set(shape, balance)
  return balance
}
