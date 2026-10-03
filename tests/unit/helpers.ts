import type opentype from 'opentype.js'
import type { WritingSessionRecord } from '@/collection/records'
import { WRITING_EXERCISES } from '@/collection/exercises'
import type { Point } from '@/font/geometry/path-ops'
import { normalizeRawStrokes, type NormalizedShape } from '@/font/geometry/shape'
import { DEFAULT_GAPS } from '@/font/layout/gap-profile'
import { EMPTY_PROPORTIONS } from '@/font/layout/proportion-profile'
import { DEFAULT_COMPOSITION_SETTINGS } from '@/font/settings'
import type { RawStroke } from '@/font/stroke/outline'
import type { HangulCompositionInputs } from '@/generation/font-builder'

export const CELL = 148

/** A finished pen stroke through `points`, which are relative to (x, y). */
export function penStroke(id: string, x: number, y: number, points: Point[], strokeWidth = 1): RawStroke {
  return { id, x, y, width: 0, height: 0, points, pressures: points.map(() => 1), strokeWidth, version: 1, lastCommittedPoint: points.at(-1) }
}

/** A jamo shape written in a 148px cell, without endpoint stabilization so its geometry is exact. */
export function shapeOf(strokes: RawStroke[], sourceCellId?: string): NormalizedShape {
  return Object.assign(normalizeRawStrokes(strokes, CELL, 0)!, sourceCellId ? { sourceCellId } : {})
}

/** Points every `step` along a straight line. */
export function line(from: Point, to: Point, step = 2): Point[] {
  const count = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / step))
  return Array.from({ length: count + 1 }, (_, index) => [
    from[0] + (to[0] - from[0]) * index / count,
    from[1] + (to[1] - from[1]) * index / count,
  ] as Point)
}

export const ring: Point[] = [[0, -20], [14, -14], [20, 0], [14, 14], [0, 20], [-14, 14], [-20, 0], [-14, -14], [0, -20]]

export const boxOf = (path: opentype.Path) => path.getBoundingBox()
export const centerOf = (path: opentype.Path) => { const b = path.getBoundingBox(); return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 } }

/** Bounding box of each closed contour, from its on-curve points. */
export function contourBoxes(path: opentype.Path) {
  const boxes: Array<{ x1: number; x2: number; y1: number; y2: number }> = []
  let points: number[][] = []
  for (const command of path.commands) {
    if ('x' in command && 'y' in command) points.push([command.x, command.y])
    if (command.type === 'Z') {
      boxes.push({
        x1: Math.min(...points.map(([x]) => x)), x2: Math.max(...points.map(([x]) => x)),
        y1: Math.min(...points.map(([, y]) => y)), y2: Math.max(...points.map(([, y]) => y)),
      })
      points = []
    }
  }
  return boxes
}

export const isFinite = (path: opentype.Path) => path.commands.every((command) => Object.values(command).every((value) => typeof value !== 'number' || Number.isFinite(value)))

/** Composition inputs of a project in which nothing has been learned yet. */
export const unlearned: HangulCompositionInputs = {
  compositionSettings: DEFAULT_COMPOSITION_SETTINGS,
  gaps: DEFAULT_GAPS,
  proportions: EMPTY_PROPORTIONS,
  hangulTargetHeight: 760,
  hangulTargetCenter: 500,
}

/**
 * A session of the sentence containing `char`, laid out in one row, with the
 * given strokes per jamo written in that syllable's cell. Stroke positions are
 * relative to the cell.
 */
export function sessionWriting(char: string, slots: RawStroke[][]): { session: WritingSessionRecord; cellIndex: number } {
  const exercise = WRITING_EXERCISES.find((item) => item.cells.some((cell) => cell.char === char))!
  const cellIndex = exercise.cells.findIndex((cell) => cell.char === char)
  const placed = slots.map((strokes) => strokes.map((stroke) => ({ ...stroke, x: stroke.x + cellIndex * CELL })))
  return {
    cellIndex,
    session: {
      exerciseId: exercise.id, text: exercise.text, cellSize: CELL, columns: exercise.cells.length, updatedAt: 0, boundaries: {}, guides: {},
      elements: placed.flat(),
      assignments: placed.flatMap((strokes, slotIndex) => strokes.map((stroke) => ({ elementId: stroke.id, cellIndex, slotIndex, promptId: exercise.cells[cellIndex].slots[slotIndex].promptId }))),
    },
  }
}
