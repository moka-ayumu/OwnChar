import opentype from 'opentype.js'
import type { GuideBox, GuideCommand, HangulRole } from '@/types/project'
import type { CompositionSettings } from '@/types/project'
import { composeHangulParts, getHangulVariantSelection, variantShapeKey, type HangulComposeOptions, type HangulParts } from './hangul'
import { decomposeHangul } from './hangul-structure'
import { appendShape, type NormalizedShape } from './path-geometry'
import { selectJamoSource } from './source-selection'

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

export function syllableRoles(codePoint: number): HangulRole[] {
  return (codePoint - 0xac00) % 28 ? roleOrder : ['initial', 'medial']
}

export function roleChar(codePoint: number, role: HangulRole) {
  return decomposeHangul(codePoint).chars[role]
}

/** The shape a fixed guide role is drawn from: the jamo captured outside the cell. */
export function guideRoleShape(codePoint: number, role: HangulRole, shapes: Map<string, NormalizedShape>, cellId: string) {
  const char = roleChar(codePoint, role)
  return char ? selectJamoSource(shapesWithoutCell(shapes, cellId), role, getHangulVariantSelection(codePoint)[role], char)?.source : undefined
}

/**
 * The composition shown as fixed guide jamo in a writing cell.
 *
 * With `guideRoles`, only those roles come from captured jamo. Every other
 * role is a placeholder, so the guide never depends on what is (being)
 * written in the cell or on which stand-in sources exist elsewhere. Roles in
 * `writtenRoles` that were already saved from this cell are laid out as
 * written, so a guide added later fits around them.
 *
 * By default all roles are guides, using sources captured outside this cell.
 */
export function composeGuideParts(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions, cellId: string, guideRoles: HangulRole[] = syllableRoles(codePoint), writtenRoles: HangulRole[] = []): HangulParts {
  const outside = shapesWithoutCell(shapes, cellId)
  const variants = getHangulVariantSelection(codePoint)
  const written = writtenRoles.flatMap((role) => {
    const char = roleChar(codePoint, role)
    const key = char ? variantShapeKey(role, variants[role], char) : ''
    const shape = shapes.get(key)
    return shape?.sourceCellId === cellId ? [[key, shape] as const] : []
  })
  const writtenReal = new Set(written.map(([key]) => key.split(':')[0] as HangulRole))
  const placeholderRoles = syllableRoles(codePoint).filter((role) => !guideRoles.includes(role) && !writtenReal.has(role))
  const sources = written.length ? new Map([...outside, ...written]) : outside
  return composeHangulParts(codePoint, sources, settings, { ...options, placeholderRoles })
}

export function guidePath(commands: GuideCommand[]) {
  const path = new opentype.Path()
  path.commands = commands.map((command) => ({ ...command })) as opentype.Path['commands']
  return path
}

/** A changed guide source drawn into the place its previous outline had. */
export function guideInBox(shape: NormalizedShape, box: GuideBox, penScale = 1) {
  const path = new opentype.Path()
  appendShape(path, shape, { x: box.x1, y: box.y1, width: Math.max(1, box.x2 - box.x1), height: Math.max(1, box.y2 - box.y1) }, false, penScale)
  return path
}
