import type { Point } from '@/font/geometry/path-ops'

interface ConditionedStroke {
  points: Point[]
  pressures: number[]
  closed: boolean
}

type StabilizeMode = 'live' | 'complete'

/** Turns sharper than this (measured over ±cornerRadius) are intentional corners. */
const CORNER_ANGLE = 55 * Math.PI / 180
/** Reference support bending less than this is treated as a straight run. */
const STRAIGHT_TURN = 6 * Math.PI / 180
/** Reference support bending more than this is a genuine curve: leave the end alone. */
const CURVED_TURN = 15 * Math.PI / 180
/** Upper bound of the hand-jitter smoothing kernel in canvas pixels. */
const MAX_SIGMA = 8
/** The kernel may also grow with the pen, up to this many pen diameters. */
const SIGMA_PER_DIAMETER = 0.7
/** Pointer positions are whole pixels, so the kernel never gets narrower than this: it hides the stair steps of a thin pen. */
const MIN_SIGMA = 5
/** The kernel also covers this share of the gap between samples, so a slow sample rate still smooths. */
const SIGMA_PER_GAP = 0.8
/** Samples are spaced this far apart before smoothing, so the kernel always sees many of them. */
const RESAMPLE_STEP = 1
/** A run deviating from its chord by less than this share is straight; by more than the max it is a curve. */
const STRAIGHT_RUN_MIN = 0.02
const STRAIGHT_RUN_MAX = 0.06

function arcLengths(points: readonly Point[]) {
  const lengths = [0]
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]))
  }
  return lengths
}

/** The sample interval containing `distance` along the stroke, or null past its end. */
function locate(lengths: readonly number[], distance: number) {
  const target = Math.max(0, Math.min(lengths.at(-1) ?? 0, distance))
  let low = 1
  let high = lengths.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (lengths[middle] < target) low = middle + 1
    else high = middle
  }
  const right = low
  if (right >= lengths.length) return null
  const left = right - 1
  const span = lengths[right] - lengths[left]
  return { left, right, t: span > 0 ? (target - lengths[left]) / span : 0 }
}

function pointAtDistance(points: readonly Point[], lengths: readonly number[], distance: number): Point {
  const at = locate(lengths, distance)
  if (!at) return [...points.at(-1)!]
  const { left, right, t } = at
  return [
    points[left][0] + (points[right][0] - points[left][0]) * t,
    points[left][1] + (points[right][1] - points[left][1]) * t,
  ]
}

function valueAtDistance(values: readonly number[], lengths: readonly number[], distance: number) {
  const at = locate(lengths, distance)
  if (!at) return values.at(-1) ?? 1
  const { left, right, t } = at
  return (values[left] ?? 1) + ((values[right] ?? values[left] ?? 1) - (values[left] ?? 1)) * t
}

function normalized(vector: Point): Point | null {
  const length = Math.hypot(vector[0], vector[1])
  return length > 1e-4 ? [vector[0] / length, vector[1] / length] : null
}

function angleBetween(a: Point, b: Point) {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])))
}

function smoothstep(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/**
 * Indices of intentional corners. The turn is measured between chords of a
 * fixed arc radius so dense jittery samples cannot fake a corner, and only the
 * sharpest sample of each neighbourhood is kept.
 */
function detectCorners(points: readonly Point[], lengths: readonly number[], diameter: number) {
  const total = lengths.at(-1) ?? 0
  const radius = Math.max(diameter * 0.6, 3)
  const turns = points.map((point, index) => {
    const distance = lengths[index]
    if (distance < diameter * 0.5 || total - distance < diameter * 0.5) return 0
    const before = pointAtDistance(points, lengths, distance - radius)
    const after = pointAtDistance(points, lengths, distance + radius)
    const incoming = Math.hypot(point[0] - before[0], point[1] - before[1]) >= radius * 0.25 ? normalized([point[0] - before[0], point[1] - before[1]]) : null
    const outgoing = Math.hypot(after[0] - point[0], after[1] - point[1]) >= radius * 0.25 ? normalized([after[0] - point[0], after[1] - point[1]]) : null
    return incoming && outgoing ? angleBetween(incoming, outgoing) : 0
  })
  const candidates = turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => turn > CORNER_ANGLE)
    .sort((a, b) => b.turn - a.turn)
  const corners: number[] = []
  for (const candidate of candidates) {
    if (corners.some((corner) => Math.abs(lengths[corner] - lengths[candidate.index]) < radius)) continue
    corners.push(candidate.index)
  }
  return corners.sort((a, b) => a - b)
}

/**
 * Arc-length Gaussian smoothing, run separately on each run between corners.
 * Run boundaries (corners and stroke ends) stay fixed; samples past a boundary
 * are point-reflected through it so straight runs keep their direction right
 * up to a corner instead of being pulled inward.
 */
function smoothRuns(points: readonly Point[], lengths: readonly number[], corners: readonly number[], sigma: number): Point[] {
  const result = points.map(([x, y]) => [x, y] as Point)
  if (sigma < 0.05) return result
  const reach = sigma * 3
  const boundaries = [0, ...corners.filter((index) => index > 0 && index < points.length - 1), points.length - 1]
  for (let run = 0; run < boundaries.length - 1; run += 1) {
    const start = boundaries[run]
    const end = boundaries[run + 1]
    for (let index = start + 1; index < end; index += 1) {
      const center = lengths[index]
      let sumX = 0; let sumY = 0; let sumWeight = 0
      const add = (x: number, y: number, distance: number) => {
        const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma))
        sumX += x * weight; sumY += y * weight; sumWeight += weight
      }
      for (let k = index; k >= start && center - lengths[k] <= reach; k -= 1) add(points[k][0], points[k][1], center - lengths[k])
      for (let k = index + 1; k <= end && lengths[k] - center <= reach; k += 1) add(points[k][0], points[k][1], lengths[k] - center)
      for (let k = start + 1; k <= end; k += 1) {
        const distance = center - (2 * lengths[start] - lengths[k])
        if (distance > reach) break
        add(2 * points[start][0] - points[k][0], 2 * points[start][1] - points[k][1], distance)
      }
      for (let k = end - 1; k >= start; k -= 1) {
        const distance = 2 * lengths[end] - lengths[k] - center
        if (distance > reach) break
        add(2 * points[end][0] - points[k][0], 2 * points[end][1] - points[k][1], distance)
      }
      result[index] = [sumX / sumWeight, sumY / sumWeight]
    }
  }
  return result
}

/**
 * A run between two corners (or stroke ends) whose body is nearly straight is
 * pulled onto its least-squares line, perpendicular to it, so samples keep
 * their place along the stroke. Hand wobble of a ruled stroke disappears, while
 * a run that bends more than a few percent of its length is a deliberate curve
 * and stays as it is. The line is fitted without the stroke-end zones (those
 * belong to `straightenEnd`), and the correction fades out toward every run
 * boundary so corners and ends do not move.
 */
function straightenRuns(points: Point[], lengths: readonly number[], corners: readonly number[], amount: number, diameter: number) {
  const total = lengths.at(-1) ?? 0
  const endReach = Math.min(Math.max(diameter * 2, 8), total * 0.3)
  const fade = diameter * 3
  const boundaries = [0, ...corners.filter((index) => index > 0 && index < points.length - 1), points.length - 1]
  for (let run = 0; run < boundaries.length - 1; run += 1) {
    const start = boundaries[run]
    const end = boundaries[run + 1]
    const body: number[] = []
    for (let index = start + 1; index < end; index += 1) {
      if (lengths[index] >= endReach && total - lengths[index] >= endReach) body.push(index)
    }
    if (body.length < 4) continue
    let meanX = 0; let meanY = 0
    for (const index of body) { meanX += points[index][0]; meanY += points[index][1] }
    meanX /= body.length; meanY /= body.length
    let sxx = 0; let sxy = 0; let syy = 0
    for (const index of body) {
      const dx = points[index][0] - meanX; const dy = points[index][1] - meanY
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    const direction: Point = [Math.cos(angle), Math.sin(angle)]
    const normal: Point = [-direction[1], direction[0]]
    const offset = (point: Point) => normal[0] * (point[0] - meanX) + normal[1] * (point[1] - meanY)
    let low = Infinity; let high = -Infinity; let deviation = 0
    for (const index of body) {
      const along = direction[0] * (points[index][0] - meanX) + direction[1] * (points[index][1] - meanY)
      low = Math.min(low, along); high = Math.max(high, along)
      deviation = Math.max(deviation, Math.abs(offset(points[index])))
    }
    const extent = high - low
    if (extent < diameter * 4) continue
    const straight = 1 - smoothstep((deviation / extent - STRAIGHT_RUN_MIN) / (STRAIGHT_RUN_MAX - STRAIGHT_RUN_MIN))
    if (straight <= 0) continue
    for (let index = start + 1; index < end; index += 1) {
      const distance = offset(points[index])
      if (Math.abs(distance) < 1e-6) continue
      const taper = smoothstep(Math.min(lengths[index] - lengths[start], lengths[end] - lengths[index]) / fade)
      const weight = amount * straight * taper
      points[index] = [points[index][0] - normal[0] * distance * weight, points[index][1] - normal[1] * distance * weight]
    }
  }
}

/**
 * Removes contact/release hooks, lateral wobble and backtracking blobs from
 * one stroke end. The stable run just behind the end defines a reference line;
 * end samples are projected onto it and forced to advance monotonically
 * toward the tip. A bent reference means the end is a real curve or corner,
 * so the correction fades out instead of flattening it.
 */
function straightenEnd(points: Point[], pressures: number[], diameter: number, amount: number, atStart: boolean) {
  const lengths = arcLengths(points)
  const total = lengths.at(-1) ?? 0
  const reach = Math.min(Math.max(diameter * 2, 8), total * 0.3)
  const span = Math.max(diameter * 2, 10)
  if (reach <= 0 || reach + span > total) return
  const fromEnd = (index: number) => atStart ? lengths[index] : total - lengths[index]
  const at = (distance: number) => pointAtDistance(points, lengths, atStart ? distance : total - distance)

  const anchor = at(reach)
  const middle = at(reach + span / 2)
  const far = at(reach + span)
  const near = normalized([anchor[0] - middle[0], anchor[1] - middle[1]])
  const back = normalized([middle[0] - far[0], middle[1] - far[1]])
  const tangent = normalized([anchor[0] - far[0], anchor[1] - far[1]])
  const samples = Array.from({ length: 8 }, (_, index) => valueAtDistance(
    pressures, lengths, atStart ? reach + span * index / 7 : total - reach - span * index / 7,
  )).sort((a, b) => a - b)
  const stablePressure = Math.max(0.1, samples[Math.floor(samples.length / 2)] ?? 1)
  const straightness = near && back && tangent
    ? 1 - smoothstep((angleBetween(near, back) - STRAIGHT_TURN) / (CURVED_TURN - STRAIGHT_TURN))
    : 0

  const order: number[] = []
  for (let index = 0; index < points.length; index += 1) if (fromEnd(index) < reach) order.push(index)
  // Walk from the stable side toward the tip.
  if (atStart) order.reverse()
  let furthest = 0
  for (const index of order) {
    const distance = fromEnd(index)
    const falloff = distance <= reach * 0.6 ? 1 : smoothstep((reach - distance) / (reach * 0.4))
    // Pen hardware commonly emits a few near-zero samples right after contact
    // and before release. Leaving those between a full-width body and the
    // round cap creates a pinched neck / detached dot.
    if (pressures[index] < 0.1) pressures[index] += (stablePressure - pressures[index]) * amount * falloff
    if (!tangent || !straightness) continue
    const point = points[index]
    furthest = Math.max(furthest, (point[0] - anchor[0]) * tangent[0] + (point[1] - anchor[1]) * tangent[1])
    const weight = amount * straightness * falloff
    points[index] = [
      point[0] + (anchor[0] + tangent[0] * furthest - point[0]) * weight,
      point[1] + (anchor[1] + tangent[1] * furthest - point[1]) * weight,
    ]
  }
}

/** The stroke sampled every `step` along its length; corners stay sharp because the pieces between samples are straight. */
function resample(points: readonly Point[], pressures: readonly number[], lengths: readonly number[], step: number) {
  const total = lengths.at(-1) ?? 0
  const count = Math.max(2, Math.ceil(total / step) + 1)
  const dense: Point[] = []
  const densePressures: number[] = []
  for (let index = 0; index < count; index += 1) {
    const distance = total * index / (count - 1)
    dense.push(pointAtDistance(points, lengths, distance))
    densePressures.push(valueAtDistance(pressures, lengths, distance))
  }
  return { points: dense, pressures: densePressures }
}

/**
 * Hand-jitter stabilizer applied at render time; captured samples are never
 * mutated. `live` leaves the moving tail alone so ink stays under the pen.
 */
export function stabilizeStroke(
  points: readonly Point[],
  pressures: readonly number[],
  diameter: number,
  mode: StabilizeMode,
  strength = 1,
): ConditionedStroke {
  const copy = points.map(([x, y]) => [x, y] as Point)
  const resultPressures = points.map((_, index) => Number.isFinite(pressures[index]) ? pressures[index] : 1)
  if (points.length < 2 || !(diameter > 0)) return { points: copy, pressures: resultPressures, closed: false }

  const lengths = arcLengths(points)
  const total = lengths.at(-1) ?? 0
  const closed = Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) <= diameter * 2
  const amount = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1))
  if (!amount || points.length < 3 || !Number.isFinite(total) || total < diameter * 2) return { points: copy, pressures: resultPressures, closed }

  const gap = total / (points.length - 1)
  const dense = resample(points, resultPressures, lengths, RESAMPLE_STEP)
  const denseLengths = arcLengths(dense.points)
  const corners = detectCorners(dense.points, denseLengths, diameter)
  const kernel = Math.max(diameter * 0.35, MIN_SIGMA, gap * SIGMA_PER_GAP)
  const result = smoothRuns(dense.points, denseLengths, corners, Math.min(Math.max(MAX_SIGMA, diameter * SIGMA_PER_DIAMETER), kernel * amount))
  if (!closed) {
    straightenEnd(result, dense.pressures, diameter, amount, true)
    if (mode === 'complete') {
      straightenEnd(result, dense.pressures, diameter, amount, false)
      straightenRuns(result, denseLengths, corners, amount, diameter)
    }
  }
  // Hand back the samples that were captured, now sitting on the smoothed path.
  const resultLengths = result.map((_, index) => total * index / (result.length - 1))
  return {
    points: lengths.map((length) => pointAtDistance(result, resultLengths, length)),
    pressures: resultPressures.some((value) => value < 0.1)
      ? lengths.map((length) => valueAtDistance(dense.pressures, resultLengths, length))
      : resultPressures,
    closed,
  }
}
