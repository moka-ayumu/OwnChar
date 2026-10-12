import opentype from 'opentype.js'
import type { HangulRole } from '@/font/hangul'
import { outlineStroke, penDiameter, type RawStroke, type StrokeMemo, type StrokeOutline } from '@/font/stroke/outline'
import { clamp, simplifyPolygon, type Point } from './path-ops'

export interface Zone {
  x: number
  y: number
  width: number
  height: number
}

/** A captured pen path in its source cell, kept so outlines can be rebuilt at a fixed pen width. */
export interface StrokeCenterline {
  points: Point[]
  pressures: number[]
  /** Recorded pen diameter in source-cell pixels. */
  diameter: number
  cellSize: number
  strength: number
}

/** A stroke outline in source-cell fractions, with the pen path it was made from. */
export interface NormalizedStroke extends StrokeOutline {
  centerline: StrokeCenterline
}

export interface NormalizedShape {
  aspectRatio: number
  /** Bounds of the ink inside the source writing cell, in cell fractions. */
  frame: Zone
  strokes: NormalizedStroke[]
  sourceCellId?: string
  sourceRole?: HangulRole
  /** Built from other captured jamo rather than written directly. */
  synthesized?: boolean
}

/** Font units per source-cell width: a contextual jamo placed in its own cell frame. */
export const CELL_UNITS = 1000

const toCell = (outline: StrokeOutline, cellSize: number): StrokeOutline => ({
  contours: outline.contours.map((contour) => contour.map(([x, y]) => [x / cellSize, y / cellSize] as Point)),
  smooth: outline.smooth,
})

/** The strokes of one jamo, in the coordinates of its `cellSize` writing cell. Undefined without ink. */
export function normalizeRawStrokes(strokes: RawStroke[], cellSize: number, endpointStabilization = 1): NormalizedShape | undefined {
  const normalized = strokes.filter((stroke) => !stroke.isDeleted && stroke.points.length).map((stroke): NormalizedStroke => {
    // perfect-freehand is not scale invariant for very small two-point input:
    // running it in 0..1 space can turn a thin line into a large semicircle.
    // Build the canonical outline in the source cell coordinate system first,
    // then normalize the completed contour.
    const points = stroke.points.map(([x, y]) => [stroke.x + x, stroke.y + y] as Point)
    const diameter = penDiameter(stroke.strokeWidth, cellSize)
    return {
      ...toCell(outlineStroke(points, stroke.pressures, diameter, true, endpointStabilization), cellSize),
      centerline: { points, pressures: [...stroke.pressures], diameter, cellSize, strength: endpointStabilization },
    }
  })
  const points = normalized.flatMap((stroke) => stroke.contours.flat())
  if (!points.length) return undefined
  const minX = Math.min(...points.map(([x]) => x))
  const maxX = Math.max(...points.map(([x]) => x))
  const minY = Math.min(...points.map(([, y]) => y))
  const maxY = Math.max(...points.map(([, y]) => y))
  const width = Math.max(1 / cellSize, maxX - minX)
  const height = Math.max(1 / cellSize, maxY - minY)
  return { aspectRatio: width / height, frame: { x: minX, y: minY, width, height }, strokes: normalized }
}

function fitZone(shape: NormalizedShape, zone: Zone): Zone {
  const zoneAspect = zone.width / zone.height
  if (shape.aspectRatio > zoneAspect) {
    const height = zone.width / shape.aspectRatio
    return { ...zone, y: zone.y + (zone.height - height) / 2, height }
  }
  const width = zone.height * shape.aspectRatio
  return { ...zone, x: zone.x + (zone.width - width) / 2, width }
}

/**
 * How far, in font units, a merged outline may be drawn from the pen's
 * polygon. The polygon has a corner every few units, far more than a glyph
 * can show: coordinates are whole units in the font.
 */
const OUTLINE_TOLERANCE = 0.75

const centerlineOutlines = new WeakMap<StrokeCenterline, Map<string, StrokeOutline>>()
const centerlineMemos = new WeakMap<StrokeCenterline, StrokeMemo>()

/** Outline a captured centerline at `renderDiameter` source pixels, in source-cell fractions. */
function outlineCenterline(centerline: StrokeCenterline, renderDiameter: number): StrokeOutline {
  let cache = centerlineOutlines.get(centerline)
  if (!cache) {
    cache = new Map()
    centerlineOutlines.set(centerline, cache)
  }
  const key = renderDiameter.toFixed(2)
  const cached = cache.get(key)
  if (cached) return cached
  const { points, pressures, diameter, cellSize, strength } = centerline
  let memo = centerlineMemos.get(centerline)
  if (!memo) centerlineMemos.set(centerline, memo = {})
  const traced = outlineStroke(points, pressures, renderDiameter, true, strength, diameter, memo)
  // The pen is rendered at its recorded width in font units, which gives the size of a font unit here.
  const fontUnit = renderDiameter * cellSize / (diameter * CELL_UNITS)
  // A smooth outline is drawn through its corners as curves; only straight-sided ones are thinned.
  const contours = traced.smooth ? traced.contours : traced.contours.map((contour) => simplifyPolygon(contour, OUTLINE_TOLERANCE * fontUnit))
  const outline = toCell({ contours, smooth: traced.smooth }, cellSize)
  if (cache.size > 96) cache.clear()
  cache.set(key, outline)
  return outline
}

/**
 * Place a shape into `targetZone`: fitted into it by its ink bounds, or, with
 * `preserveCellFrame`, with the zone standing for the whole source cell.
 * Strokes are re-outlined after placement so the pen keeps its recorded width
 * (times `penScale`) in font units, however much the jamo itself is enlarged
 * or reduced.
 */
export function appendShape(path: opentype.Path, shape: NormalizedShape, targetZone: Zone, preserveCellFrame = false, penScale = 1) {
  const source = preserveCellFrame ? { x: 0, y: 0, width: 1, height: 1 } : shape.frame
  const placement = preserveCellFrame ? targetZone : fitZone(shape, targetZone)
  const unitsPerCell = Math.sqrt(placement.width / source.width * placement.height / source.height)
  for (const captured of shape.strokes) {
    const stroke = unitsPerCell > 0
      ? outlineCenterline(captured.centerline, captured.centerline.diameter * CELL_UNITS * penScale / unitsPerCell)
      : captured
    for (const sourceContour of stroke.contours) {
      const contour = sourceContour.map(([x, y]) => [
        placement.x + (preserveCellFrame ? x : (x - source.x) / source.width) * placement.width,
        placement.y + (1 - (preserveCellFrame ? y : (y - source.y) / source.height)) * placement.height,
      ] as Point)
      if (!contour.length) continue
      path.moveTo(contour[0][0], contour[0][1])
      if (stroke.smooth) {
        for (let index = 1; index < contour.length; index += 1) {
          const next = contour[(index + 1) % contour.length]
          path.quadTo(contour[index][0], contour[index][1], (contour[index][0] + next[0]) / 2, (contour[index][1] + next[1]) / 2)
        }
        path.quadTo(contour[0][0], contour[0][1], contour[0][0], contour[0][1])
      } else {
        for (let index = 1; index < contour.length; index += 1) path.lineTo(contour[index][0], contour[index][1])
      }
      path.close()
    }
  }
}

/**
 * Two captured jamo scaled to the same height and set side by side as a
 * compound final such as ㄺ, their widths drawn toward their average.
 * Centerlines move with their contours, so the result is re-outlined at the
 * recorded pen width. A result wider than `maxAspect` (width / height) is
 * narrowed horizontally, the wider part first. `gapShare` is the share of
 * the gap of a compound final that is left between the parts.
 */
export function combineShapesSideBySide(left: NormalizedShape, right: NormalizedShape, maxAspect = Infinity, gapShare = 1): NormalizedShape {
  // Stay at the written cell scale: the pen is re-outlined at its recorded
  // width, so the gap between the parts is measured in pen diameters.
  const height = (left.frame.height + right.frame.height) / 2
  const pen = Math.max(...[...left.strokes, ...right.strokes].map((stroke) => stroke.centerline.diameter / stroke.centerline.cellSize))
  const gap = (pen * 1.5 + height * 0.05) * gapShare
  const natural = [left, right].map((part) => part.frame.width * height / part.frame.height)
  // Past these limits a jamo stops reading as itself.
  const widths = natural.map((width) => width * clamp((natural[0] + natural[1]) / 2 / width, 0.6, 1.4))
  const available = maxAspect * height - gap
  // Only the wider part gives way until both are equally wide. Neither goes
  // below what the wider can bear: the caller takes the rest off the whole.
  const widest = widths[0] + widths[1] > available ? Math.max(available - Math.min(...widths), available / 2, Math.max(...natural) * 0.6) : Infinity
  const strokes: NormalizedStroke[] = []
  let offsetX = 0
  for (const [index, part] of [left, right].entries()) {
    const frame = part.frame
    const scale = height / frame.height
    const stretch = Math.min(widths[index], widest) / natural[index]
    const map = ([x, y]: Point) => [offsetX + (x - frame.x) * scale * stretch, (y - frame.y) * scale] as Point
    for (const stroke of part.strokes) {
      const centerline = stroke.centerline
      strokes.push({
        contours: stroke.contours.map((contour) => contour.map(map)),
        smooth: stroke.smooth,
        centerline: {
          ...centerline,
          points: centerline.points.map(([x, y]) => {
            const [mappedX, mappedY] = map([x / centerline.cellSize, y / centerline.cellSize])
            return [mappedX * centerline.cellSize, mappedY * centerline.cellSize] as Point
          }),
        },
      })
    }
    offsetX += natural[index] * stretch + gap
  }
  const width = offsetX - gap
  return { aspectRatio: width / height, frame: { x: 0, y: 0, width, height }, strokes, synthesized: true }
}

/**
 * `shape` made `factor` times as wide about the left of its ink, its height
 * kept. Centerlines move with their contours, so the pen keeps its width.
 */
export function stretchShapeWidth(shape: NormalizedShape, factor: number): NormalizedShape {
  const { frame } = shape
  const map = ([x, y]: Point) => [frame.x + (x - frame.x) * factor, y] as Point
  return {
    ...shape,
    aspectRatio: shape.aspectRatio * factor,
    frame: { ...frame, width: frame.width * factor },
    strokes: shape.strokes.map((stroke) => ({
      ...stroke,
      contours: stroke.contours.map((contour) => contour.map(map)),
      centerline: {
        ...stroke.centerline,
        points: stroke.centerline.points.map(([x, y]) => {
          const [mappedX] = map([x / stroke.centerline.cellSize, y])
          return [mappedX * stroke.centerline.cellSize, y] as Point
        }),
      },
    })),
  }
}

/** `zone` scaled about its own centre. */
export function scaleZone(zone: Zone, factor: number): Zone {
  return {
    x: zone.x + zone.width * (1 - factor) / 2,
    y: zone.y + zone.height * (1 - factor) / 2,
    width: zone.width * factor,
    height: zone.height * factor,
  }
}
