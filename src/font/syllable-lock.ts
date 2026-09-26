import opentype from 'opentype.js'
import type { HangulRole } from '@/types/project'
import type { CompositionSettings } from '@/types/project'
import { composeHangulParts, getHangulVariantSelection, CHOSEONG, JONGSEONG, JUNGSEONG, variantShapeKey, type HangulComposeOptions, type HangulParts } from './hangul'
import { appendShape, CELL_UNITS, type NormalizedShape } from './path-geometry'

/**
 * A syllable cell that mixes fixed guide jamo (captured elsewhere) with jamo
 * the user wrote in that very cell. The font must reproduce the cell exactly.
 */
export interface LockedSyllable {
  cellId: string
  writtenRoles: HangulRole[]
}

const roleOrder: HangulRole[] = ['initial', 'medial', 'final']
const withoutCellCache = new WeakMap<Map<string, NormalizedShape>, Map<string, Map<string, NormalizedShape>>>()

/** The sources a syllable cell had before anything was written into it. */
export function shapesWithoutCell(shapes: Map<string, NormalizedShape>, cellId: string) {
  let byCell = withoutCellCache.get(shapes)
  if (!byCell) {
    byCell = new Map()
    withoutCellCache.set(shapes, byCell)
  }
  const cached = byCell.get(cellId)
  if (cached) return cached
  const filtered = new Map([...shapes].filter(([, shape]) => shape.sourceCellId !== cellId))
  byCell.set(cellId, filtered)
  return filtered
}

/**
 * The composition shown as fixed guide jamo in a writing cell. Jamo written in
 * the cell itself are excluded so the guide does not move while writing.
 */
export function composeGuideParts(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions, cellId: string): HangulParts {
  return composeHangulParts(codePoint, shapesWithoutCell(shapes, cellId), settings, options)
}

function roleChar(codePoint: number, role: HangulRole) {
  const offset = codePoint - 0xac00
  if (role === 'initial') return CHOSEONG[Math.floor(offset / 588)][0]
  if (role === 'medial') return JUNGSEONG[Math.floor((offset % 588) / 28)][0]
  return JONGSEONG[offset % 28][0]
}

/** Guide jamo exactly as the canvas shows them, plus written jamo exactly where they were written. */
export function composeLockedHangulPath(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions, lock: LockedSyllable) {
  const { parts } = composeGuideParts(codePoint, shapes, settings, options, lock.cellId)
  const variants = getHangulVariantSelection(codePoint)
  const path = new opentype.Path()
  for (const role of roleOrder) {
    if (!lock.writtenRoles.includes(role)) path.commands.push(...parts[role].commands.map((command) => ({ ...command })))
  }
  for (const role of lock.writtenRoles) {
    const char = roleChar(codePoint, role)
    const shape = char ? shapes.get(variantShapeKey(role, variants[role], char)) : undefined
    if (shape?.sourceCellId !== lock.cellId) continue
    appendShape(path, shape, { x: 0, y: 0, width: CELL_UNITS, height: CELL_UNITS }, true, options.penScale ?? 1)
  }
  return path
}
