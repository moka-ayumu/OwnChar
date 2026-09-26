import opentype from 'opentype.js'
import svgPathParser from 'svg-path-parser'
import type { GlyphOverride, StrokePath } from '@/types/project'
import { REFERENCE_CELL_SIZE, STROKE_SIZE_FACTOR, strokeContours, strokeNeedsUnion, strokePolygon, type RawStroke } from './stroke-outline'

const { makeAbsolute, parseSVG } = svgPathParser

export interface Zone {
  x: number
  y: number
  width: number
  height: number
}

interface NormalizedCommand {
  code: string
  x?: number
  y?: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
}

/** A captured pen path in its source cell, kept so outlines can be rebuilt at a fixed pen width. */
export interface StrokeCenterline {
  points: [number, number][]
  pressures: number[]
  /** Recorded pen diameter in source-cell pixels. */
  diameter: number
  cellSize: number
  strength: number
}

export interface NormalizedStroke {
  contours: [number, number][][]
  smooth: boolean
  centerline?: StrokeCenterline
}

export interface NormalizedShape {
  commands: NormalizedCommand[]
  aspectRatio: number
  /** Bounds of the ink inside the source writing cell, in cell fractions. */
  frame?: Zone
  strokes?: NormalizedStroke[]
  sourceCellId?: string
  sourceRole?: 'initial' | 'medial' | 'final'
}

/** Font units per source-cell width: a contextual jamo placed in its own cell frame. */
export const CELL_UNITS = 1000

const coordinatePairs = [
  ['x', 'y'],
  ['x1', 'y1'],
  ['x2', 'y2'],
] as const

export function normalizeStrokePaths(paths: StrokePath[], cellSize?: number): NormalizedShape {
  const commands: Array<Record<string, any>> = []
  const points: Array<[number, number]> = []

  for (const stroke of paths) {
    const absolute = makeAbsolute(parseSVG(stroke.d)) as Array<Record<string, any>>
    for (const command of absolute) {
      const translated = { ...command }
      for (const [xKey, yKey] of coordinatePairs) {
        if (typeof command[xKey] === 'number' && typeof command[yKey] === 'number') {
          translated[xKey] = command[xKey] + stroke.x
          translated[yKey] = command[yKey] + stroke.y
          points.push([translated[xKey], translated[yKey]])
        }
      }
      commands.push(translated)
    }
  }

  if (!points.length) return { commands: [], aspectRatio: 1 }
  const minX = Math.min(...points.map(([x]) => x))
  const maxX = Math.max(...points.map(([x]) => x))
  const minY = Math.min(...points.map(([, y]) => y))
  const maxY = Math.max(...points.map(([, y]) => y))
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  const normalizedCommands = commands.map((command) => {
    const normalized: NormalizedCommand = { code: command.code }
    for (const [xKey, yKey] of coordinatePairs) {
      if (typeof command[xKey] === 'number' && typeof command[yKey] === 'number') {
        normalized[xKey] = (command[xKey] - minX) / width
        normalized[yKey] = (command[yKey] - minY) / height
      }
    }
    return normalized
  })

  return {
    aspectRatio: width / height,
    commands: normalizedCommands,
    ...(cellSize && cellSize > 0 ? { frame: {
      x: minX / cellSize,
      y: minY / cellSize,
      width: width / cellSize,
      height: height / cellSize,
    } } : {}),
  }
}

export function normalizeRawStrokes(strokes: RawStroke[], cellSize: number, endpointStabilization = 1): NormalizedShape {
  const raw = strokes.filter((stroke) => !stroke.isDeleted && stroke.points.length).map((stroke) => {
    // perfect-freehand is not scale invariant for very small two-point input:
    // running it in 0..1 space can turn a thin line into a large semicircle.
    // Build the canonical outline in the source cell coordinate system first,
    // then normalize the completed contour.
    const points = stroke.points.map(([x, y]) => [stroke.x + x, stroke.y + y] as [number, number])
    const diameter = stroke.strokeWidth * STROKE_SIZE_FACTOR * cellSize / REFERENCE_CELL_SIZE
    const needsUnion = strokeNeedsUnion(points, diameter, stroke.pressures, endpointStabilization)
    return {
      contours: (needsUnion
        ? strokeContours(points, stroke.pressures, diameter, true, endpointStabilization)
        : [strokePolygon(points, stroke.pressures, diameter, true, endpointStabilization)])
        .map((contour) => contour.map(([x, y]) => [x / cellSize, y / cellSize] as [number, number])),
      smooth: !needsUnion,
      centerline: { points, pressures: [...stroke.pressures], diameter, cellSize, strength: endpointStabilization },
    }
  })
  const points = raw.flatMap((stroke) => stroke.contours.flat())
  if (!points.length) return { commands: [], aspectRatio: 1, strokes: [] }
  const minX = Math.min(...points.map(([x]) => x))
  const maxX = Math.max(...points.map(([x]) => x))
  const minY = Math.min(...points.map(([, y]) => y))
  const maxY = Math.max(...points.map(([, y]) => y))
  const width = Math.max(1 / cellSize, maxX - minX)
  const height = Math.max(1 / cellSize, maxY - minY)
  return { commands: [], aspectRatio: width / height, frame: { x: minX, y: minY, width, height }, strokes: raw }
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

const centerlineOutlines = new WeakMap<StrokeCenterline, Map<string, NormalizedStroke>>()

/** Outline a captured centerline at `renderDiameter` source pixels, in source-cell fractions. */
function outlineCenterline(centerline: StrokeCenterline, renderDiameter: number): NormalizedStroke {
  let cache = centerlineOutlines.get(centerline)
  if (!cache) {
    cache = new Map()
    centerlineOutlines.set(centerline, cache)
  }
  const key = renderDiameter.toFixed(2)
  const cached = cache.get(key)
  if (cached) return cached
  const { points, pressures, diameter, cellSize, strength } = centerline
  const needsUnion = strokeNeedsUnion(points, renderDiameter, pressures, strength, diameter)
  const outline: NormalizedStroke = {
    contours: (needsUnion
      ? strokeContours(points, pressures, renderDiameter, true, strength, diameter)
      : [strokePolygon(points, pressures, renderDiameter, true, strength, diameter)])
      .map((contour) => contour.map(([x, y]) => [x / cellSize, y / cellSize] as [number, number])),
    smooth: !needsUnion,
  }
  if (cache.size > 96) cache.clear()
  cache.set(key, outline)
  return outline
}

/**
 * Place a shape into `targetZone`. Captured strokes are re-outlined after
 * placement so the pen keeps its recorded width (times `penScale`) in font
 * units, however much the jamo itself is enlarged or reduced.
 */
export function appendShape(path: opentype.Path, shape: NormalizedShape, targetZone: Zone, preserveCellFrame = false, penScale = 1) {
  const frame = preserveCellFrame ? shape.frame : undefined
  const zone = frame ? {
    x: targetZone.x + frame.x * targetZone.width,
    y: targetZone.y + (1 - frame.y - frame.height) * targetZone.height,
    width: frame.width * targetZone.width,
    height: frame.height * targetZone.height,
  } : fitZone(shape, targetZone)
  if (shape.strokes) {
    const source = shape.frame ?? { x: 0, y: 0, width: 1, height: 1 }
    const placement = preserveCellFrame ? targetZone : zone
    const unitsPerCell = Math.sqrt(
      placement.width / (preserveCellFrame ? 1 : source.width)
      * placement.height / (preserveCellFrame ? 1 : source.height),
    )
    for (const captured of shape.strokes) {
      const stroke = captured.centerline && unitsPerCell > 0
        ? outlineCenterline(captured.centerline, captured.centerline.diameter * CELL_UNITS * penScale / unitsPerCell)
        : captured
      for (const sourceContour of stroke.contours) {
        const contour = sourceContour.map(([x, y]) => [
          placement.x + (preserveCellFrame ? x : (x - source.x) / source.width) * placement.width,
          placement.y + (1 - (preserveCellFrame ? y : (y - source.y) / source.height)) * placement.height,
        ] as [number, number])
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
    return
  }
  const point = (x: number, y: number) => [zone.x + x * zone.width, zone.y + (1 - y) * zone.height] as const

  for (const command of shape.commands) {
    const code = command.code.toUpperCase()
    if (code === 'M' && command.x !== undefined && command.y !== undefined) {
      path.moveTo(...point(command.x, command.y))
    } else if (code === 'L' && command.x !== undefined && command.y !== undefined) {
      path.lineTo(...point(command.x, command.y))
    } else if (code === 'C' && command.x1 !== undefined && command.y1 !== undefined && command.x2 !== undefined && command.y2 !== undefined && command.x !== undefined && command.y !== undefined) {
      const first = point(command.x1, command.y1)
      const second = point(command.x2, command.y2)
      const end = point(command.x, command.y)
      path.curveTo(first[0], first[1], second[0], second[1], end[0], end[1])
    } else if (code === 'Q' && command.x1 !== undefined && command.y1 !== undefined && command.x !== undefined && command.y !== undefined) {
      const control = point(command.x1, command.y1)
      const end = point(command.x, command.y)
      path.quadTo(control[0], control[1], end[0], end[1])
    } else if (code === 'Z') {
      path.close()
    }
  }
}

export function transformPath(path: opentype.Path, override?: GlyphOverride) {
  if (!override) return path
  const box = path.getBoundingBox()
  const centerX = (box.x1 + box.x2) / 2
  const centerY = (box.y1 + box.y2) / 2
  const radians = override.rotation * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  for (const command of path.commands as Array<Record<string, any>>) {
    for (const [xKey, yKey] of coordinatePairs) {
      if (typeof command[xKey] !== 'number' || typeof command[yKey] !== 'number') continue
      const x = (command[xKey] - centerX) * override.scale
      const y = (command[yKey] - centerY) * override.scale
      command[xKey] = x * cos - y * sin + centerX + override.left
      command[yKey] = x * sin + y * cos + centerY + override.y
    }
  }
  return path
}

export function splitHorizontal(zone: Zone, count: number, gap = 24) {
  const width = (zone.width - gap * (count - 1)) / count
  return Array.from({ length: count }, (_, index) => ({
    x: zone.x + index * (width + gap),
    y: zone.y,
    width,
    height: zone.height,
  }))
}
