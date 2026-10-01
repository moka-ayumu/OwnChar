import opentype from 'opentype.js'

export type Point = [number, number]

function flatten(path: opentype.Path, tolerance = 2): Point[][] {
  const contours: Point[][] = []
  let contour: Point[] = []
  let current: Point = [0, 0]
  const add = (point: Point) => { contour.push(point); current = point }
  for (const command of path.commands) {
    if (command.type === 'M') {
      if (contour.length > 2) contours.push(contour)
      contour = []
      add([command.x, command.y])
    } else if (command.type === 'L') {
      add([command.x, command.y])
    } else if (command.type === 'Q') {
      const start = current
      const steps = Math.max(4, Math.min(24, Math.ceil((Math.hypot(command.x1 - start[0], command.y1 - start[1]) + Math.hypot(command.x - command.x1, command.y - command.y1)) / Math.max(0.5, tolerance))))
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps
        const s = 1 - t
        add([s * s * start[0] + 2 * s * t * command.x1 + t * t * command.x,
          s * s * start[1] + 2 * s * t * command.y1 + t * t * command.y])
      }
    } else if (command.type === 'C') {
      const start = current
      const steps = Math.max(6, Math.min(32, Math.ceil((Math.hypot(command.x1 - start[0], command.y1 - start[1]) + Math.hypot(command.x2 - command.x1, command.y2 - command.y1) + Math.hypot(command.x - command.x2, command.y - command.y2)) / Math.max(0.5, tolerance))))
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps
        const s = 1 - t
        add([s ** 3 * start[0] + 3 * s * s * t * command.x1 + 3 * s * t * t * command.x2 + t ** 3 * command.x,
          s ** 3 * start[1] + 3 * s * s * t * command.y1 + 3 * s * t * t * command.y2 + t ** 3 * command.y])
      }
    } else if (command.type === 'Z' && contour.length > 2) {
      contours.push(contour)
      contour = []
    }
  }
  if (contour.length > 2) contours.push(contour)
  return contours
}

interface PreparedSegment {
  start: Point
  end: Point
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PreparedOutline {
  contours: Point[][]
  segments: PreparedSegment[]
}

export function prepareOutline(path: opentype.Path, tolerance = 2): PreparedOutline {
  const contours = flatten(path, tolerance)
  const segments: PreparedSegment[] = []
  for (const contour of contours) for (let index = 0; index < contour.length; index += 1) {
    const start = contour[index]
    const end = contour[(index + 1) % contour.length]
    segments.push({
      start,
      end,
      minX: Math.min(start[0], end[0]),
      minY: Math.min(start[1], end[1]),
      maxX: Math.max(start[0], end[0]),
      maxY: Math.max(start[1], end[1]),
    })
  }
  return { contours, segments }
}

function translated(contours: Point[][], dx: number, dy: number) {
  return contours.map((contour) => contour.map(([x, y]) => [x + dx, y + dy] as Point))
}

function orient(a: Point, b: Point, c: Point) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const epsilon = 1e-6
  const abC = orient(a, b, c); const abD = orient(a, b, d)
  const cdA = orient(c, d, a); const cdB = orient(c, d, b)
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
      ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true
  const on = (p: Point, q: Point, r: Point) => Math.abs(orient(p, q, r)) <= epsilon &&
    r[0] >= Math.min(p[0], q[0]) - epsilon && r[0] <= Math.max(p[0], q[0]) + epsilon &&
    r[1] >= Math.min(p[1], q[1]) - epsilon && r[1] <= Math.max(p[1], q[1]) + epsilon
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)
}

function pointSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0]; const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy)
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

function everySegment(contours: Point[][], callback: (start: Point, end: Point) => boolean | void) {
  for (const contour of contours) for (let index = 0; index < contour.length; index += 1) {
    if (callback(contour[index], contour[(index + 1) % contour.length])) return true
  }
  return false
}

function contoursIntersect(a: Point[][], b: Point[][]) {
  if (everySegment(a, (a0, a1) => everySegment(b, (b0, b1) => segmentsIntersect(a0, a1, b0, b1)))) return true
  const aPoint = a[0]?.[0]; const bPoint = b[0]?.[0]
  return Boolean((aPoint && contains(b, aPoint[0], aPoint[1])) || (bPoint && contains(a, bPoint[0], bPoint[1])))
}

export function outlinesIntersect(first: opentype.Path, second: opentype.Path, dx = 0, dy = 0) {
  return contoursIntersect(flatten(first), translated(flatten(second), dx, dy))
}

function preparedDistance(a: PreparedOutline, b: PreparedOutline, dx = 0, dy = 0, stopBelow = -Infinity) {
  if (!a.contours.length || !b.contours.length) return Infinity
  let minimum = Infinity
  for (const first of a.segments) for (const second of b.segments) {
    const boxDx = Math.max(0, Math.max(first.minX, second.minX + dx) - Math.min(first.maxX, second.maxX + dx))
    const boxDy = Math.max(0, Math.max(first.minY, second.minY + dy) - Math.min(first.maxY, second.maxY + dy))
    if (Math.hypot(boxDx, boxDy) >= minimum) continue
    const movedStart: Point = [second.start[0] + dx, second.start[1] + dy]
    const movedEnd: Point = [second.end[0] + dx, second.end[1] + dy]
    minimum = Math.min(minimum, segmentDistance(first.start, first.end, movedStart, movedEnd))
    if (minimum <= stopBelow) return minimum
  }
  if (minimum === 0) return 0
  const aPoint = a.contours[0]?.[0]; const bPoint = b.contours[0]?.[0]
  if ((aPoint && contains(b.contours, aPoint[0] - dx, aPoint[1] - dy)) ||
      (bPoint && contains(a.contours, bPoint[0] + dx, bPoint[1] + dy))) return 0
  return minimum
}

/** Segments of one outline bucketed by position, so a clearance query only meets its neighbours. */
interface SegmentGrid {
  size: number
  buckets: Map<number, number[]>
}

const bucketKey = (x: number, y: number) => (x + 8192) * 16384 + (y + 8192)

function buildGrid(outline: PreparedOutline, size: number): SegmentGrid {
  const buckets = new Map<number, number[]>()
  outline.segments.forEach((segment, index) => {
    const x2 = Math.floor(segment.maxX / size)
    const y2 = Math.floor(segment.maxY / size)
    for (let x = Math.floor(segment.minX / size); x <= x2; x += 1) {
      for (let y = Math.floor(segment.minY / size); y <= y2; y += 1) {
        const key = bucketKey(x, y)
        const bucket = buckets.get(key)
        if (bucket) bucket.push(index)
        else buckets.set(key, [index])
      }
    }
  })
  return { size, buckets }
}

/**
 * Whether `moving`, shifted by (dx, dy), keeps at least `clearance` from
 * `fixed`. Same answer as `preparedDistance(...) >= clearance`, but only
 * segment pairs within `clearance` of each other are ever compared.
 */
function keepsClearance(fixed: PreparedOutline, moving: PreparedOutline, grid: SegmentGrid, dx: number, dy: number, clearance: number) {
  if (!fixed.contours.length || !moving.contours.length) return true
  const { size, buckets } = grid
  for (const first of fixed.segments) {
    const x1 = Math.floor((first.minX - clearance - dx) / size)
    const x2 = Math.floor((first.maxX + clearance - dx) / size)
    const y1 = Math.floor((first.minY - clearance - dy) / size)
    const y2 = Math.floor((first.maxY + clearance - dy) / size)
    for (let x = x1; x <= x2; x += 1) {
      for (let y = y1; y <= y2; y += 1) {
        const bucket = buckets.get(bucketKey(x, y))
        if (!bucket) continue
        for (const index of bucket) {
          const second = moving.segments[index]
          const boxDx = Math.max(0, Math.max(first.minX, second.minX + dx) - Math.min(first.maxX, second.maxX + dx))
          const boxDy = Math.max(0, Math.max(first.minY, second.minY + dy) - Math.min(first.maxY, second.maxY + dy))
          if (Math.hypot(boxDx, boxDy) >= clearance) continue
          const movedStart: Point = [second.start[0] + dx, second.start[1] + dy]
          const movedEnd: Point = [second.end[0] + dx, second.end[1] + dy]
          if (segmentDistance(first.start, first.end, movedStart, movedEnd) < clearance) return false
        }
      }
    }
  }
  // No edges are close; one outline can still sit entirely inside the other.
  const aPoint = fixed.contours[0]?.[0]; const bPoint = moving.contours[0]?.[0]
  if ((aPoint && contains(moving.contours, aPoint[0] - dx, aPoint[1] - dy)) ||
      (bPoint && contains(fixed.contours, bPoint[0] + dx, bPoint[1] + dy))) return false
  return true
}

export function minimumInkDistance(first: opentype.Path, second: opentype.Path, dx = 0, dy = 0) {
  return preparedDistance(prepareOutline(first), prepareOutline(second), dx, dy)
}

/** Early-out clearance check using the intrusion solver's spatial grid. */
export function hasInkClearance(first: opentype.Path, second: opentype.Path, clearance: number) {
  const a = prepareOutline(first); const b = prepareOutline(second)
  return keepsClearance(a, b, buildGrid(b, Math.max(4, clearance)), 0, 0, clearance - 1e-3)
}

export interface SafeIntrusionOptions {
  axis: 'x' | 'y'
  direction: -1 | 1
  clearance: number
  maximum: number
  step?: number
}

/** Find the furthest collision-free translation without mutating either path. */
export function maximizeSafeIntrusion(fixed: opentype.Path | PreparedOutline, moving: opentype.Path | PreparedOutline, options: SafeIntrusionOptions) {
  if (options.maximum <= 0) return 0
  const flattenTolerance = Math.max(0.5, options.clearance / 6)
  const fixedOutline = fixed instanceof opentype.Path ? prepareOutline(fixed, flattenTolerance) : fixed
  const movingOutline = moving instanceof opentype.Path ? prepareOutline(moving, flattenTolerance) : moving
  if (!fixedOutline.segments.length || !movingOutline.segments.length) return 0
  const offset = (distance: number) => options.axis === 'x'
    ? [distance * options.direction, 0] as const
    : [0, distance * options.direction] as const
  const clearance = options.clearance - 1e-3
  const grid = buildGrid(movingOutline, Math.max(4, clearance))
  const safe = (distance: number) => {
    const [dx, dy] = offset(distance)
    return keepsClearance(fixedOutline, movingOutline, grid, dx, dy, clearance)
  }
  if (!safe(0)) return 0
  const step = Math.max(1, options.step ?? options.clearance / 2)
  let safeDistance = 0
  let unsafeDistance = options.maximum
  for (let distance = step; distance <= options.maximum; distance += step) {
    if (!safe(distance)) { unsafeDistance = distance; break }
    safeDistance = distance
  }
  if (safeDistance >= options.maximum - 1e-6) return options.maximum
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const middle = (safeDistance + unsafeDistance) / 2
    if (safe(middle)) safeDistance = middle
    else unsafeDistance = middle
  }
  return safeDistance
}

function contains(contours: Point[][], x: number, y: number) {
  let winding = 0
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index += 1) {
      const start = contour[index]
      const end = contour[(index + 1) % contour.length]
      const side = (end[0] - start[0]) * (y - start[1]) - (end[1] - start[1]) * (x - start[0])
      if (start[1] <= y && end[1] > y && side > 0) winding += 1
      if (start[1] > y && end[1] <= y && side < 0) winding -= 1
    }
  }
  return winding !== 0
}

/** A small occupancy estimate is sufficient to distinguish a stroke crossing from a broad merger. */
export function inkIntersectionArea(first: opentype.Path, second: opentype.Path) {
  if (!first.commands.length || !second.commands.length) return 0
  const a = first.getBoundingBox()
  const b = second.getBoundingBox()
  const left = Math.max(a.x1, b.x1)
  const right = Math.min(a.x2, b.x2)
  const bottom = Math.max(a.y1, b.y1)
  const top = Math.min(a.y2, b.y2)
  if (right <= left || top <= bottom) return 0
  const firstContours = flatten(first)
  const secondContours = flatten(second)
  const columns = Math.max(4, Math.min(16, Math.ceil((right - left) / 8)))
  const rows = Math.max(4, Math.min(16, Math.ceil((top - bottom) / 8)))
  let occupied = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = left + (column + 0.5) * (right - left) / columns
      const y = bottom + (row + 0.5) * (top - bottom) / rows
      if (contains(firstContours, x, y) && contains(secondContours, x, y)) occupied += 1
    }
  }
  return occupied * (right - left) * (top - bottom) / (rows * columns)
}
