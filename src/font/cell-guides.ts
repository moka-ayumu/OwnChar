import type opentype from 'opentype.js'
import type { DrawingRecord, GuideBox, GuideCommand, HangulRole, StoredCellGuide, StoredGuideRole } from '@/types/project'
import type { HangulComposeOptions } from './hangul'
import type { NormalizedShape } from './path-geometry'
import { composeGuideParts, guideInBox, guideRoleShape } from './syllable-lock'
import type { CompositionSettings } from '@/types/project'

/** Identifies the drawing a guide outline was made from; it changes only when the jamo is rewritten. */
export function guideSourceTag(record: DrawingRecord | undefined) {
  if (!record) return ''
  const content = record.previewSvg || JSON.stringify(record.paths)
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${record.promptId}:${(hash >>> 0).toString(36)}`
}

const round = (value: number) => Math.round(value * 100) / 100

/** Keep automatic ink and its reserved spaces inset together, without changing aspect ratios. */
function insetGuide(guide: StoredCellGuide): StoredCellGuide {
  if (guide.sizingVersion === 2) return guide
  const boxes = [...Object.values(guide.roles).map(role => role.box), ...Object.values(guide.placeholders)]
  const factor = 0.8
  const scaled = (value: number) => 500 + (value - 500) * factor
  // Correct an off-centre composition by moving it, never by shrinking again.
  const offset = (axis: 'x' | 'y') => {
    if (!boxes.length) return 0
    const low = Math.min(...boxes.map(b => scaled(b[axis === 'x' ? 'x1' : 'y1'])))
    const high = Math.max(...boxes.map(b => scaled(b[axis === 'x' ? 'x2' : 'y2'])))
    return low < 100 ? 100 - low : high > 900 ? 900 - high : 0
  }
  const dx = offset('x'); const dy = offset('y')
  const coordinate = (value: number, axis: 'x' | 'y') => round(scaled(value) + (axis === 'x' ? dx : dy))
  const transformBox = (b: GuideBox): GuideBox => ({ x1: coordinate(b.x1, 'x'), y1: coordinate(b.y1, 'y'), x2: coordinate(b.x2, 'x'), y2: coordinate(b.y2, 'y') })
  return {
    sizingVersion: 2,
    roles: Object.fromEntries(Object.entries(guide.roles).map(([role, entry]) => [role, {
      ...entry, box: transformBox(entry.box), commands: entry.commands.map(command => {
        const transformed = { ...command }
        for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2'] as const) {
          if (typeof transformed[key] === 'number') transformed[key] = coordinate(transformed[key], key.startsWith('x') ? 'x' : 'y')
        }
        return transformed
      }),
    }])),
    placeholders: Object.fromEntries(Object.entries(guide.placeholders).map(([role, b]) => [role, transformBox(b)])),
  }
}

export function toGuideCommands(path: opentype.Path): GuideCommand[] {
  return (path.commands as Array<Record<string, unknown>>).map((command) => {
    const result: GuideCommand = { type: String(command.type) }
    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2'] as const) {
      if (typeof command[key] === 'number') result[key] = round(command[key] as number)
    }
    return result
  })
}

function box(path: opentype.Path): GuideBox | undefined {
  if (!path.commands.length) return undefined
  const bounds = path.getBoundingBox()
  return { x1: round(bounds.x1), y1: round(bounds.y1), x2: round(bounds.x2), y2: round(bounds.y2) }
}

/** Free space kept between a writing band and the guide jamo or the cell edge. */
const BAND_MARGIN = 24
const CELL_EDGE = 36

/**
 * The room a jamo still to be written may use: its natural place grown toward
 * every side until it would reach a guide jamo or the cell edge, by at most its
 * own size per side. Drawn as a faint band so the writer sees where strokes may
 * go without touching the guides. A guide counts as lying on the side its
 * centre is on, even when its box already reaches into the place a little.
 */
export function writingBand(place: GuideBox, others: GuideBox[]): GuideBox {
  const width = place.x2 - place.x1
  const height = place.y2 - place.y1
  const centerX = (place.x1 + place.x2) / 2
  const centerY = (place.y1 + place.y2) / 2
  const band = {
    x1: Math.max(CELL_EDGE, place.x1 - width), x2: Math.min(1000 - CELL_EDGE, place.x2 + width),
    y1: Math.max(CELL_EDGE, place.y1 - height), y2: Math.min(1000 - CELL_EDGE, place.y2 + height),
  }
  const overlap = (from: number, to: number, otherFrom: number, otherTo: number) => Math.min(to, otherTo) - Math.max(from, otherFrom)
  // A guide only limits the band on a side when it really shares that row or column with the place.
  // Vertical limits first, from guides sharing the place's columns; then horizontal ones, from guides sharing the band's rows.
  for (const other of others) {
    if (overlap(other.x1, other.x2, place.x1, place.x2) < width / 2) continue
    if ((other.y1 + other.y2) / 2 < centerY) band.y1 = Math.max(band.y1, other.y2 + BAND_MARGIN)
    else band.y2 = Math.min(band.y2, other.y1 - BAND_MARGIN)
  }
  const y1 = Math.min(band.y1, place.y1)
  const y2 = Math.max(band.y2, place.y2)
  for (const other of others) {
    if (overlap(other.y1, other.y2, place.y1, place.y2) < height / 2) continue
    if ((other.x1 + other.x2) / 2 < centerX) band.x1 = Math.max(band.x1, other.x2 + BAND_MARGIN)
    else band.x2 = Math.min(band.x2, other.x1 - BAND_MARGIN)
  }
  // The place itself is always inside its band, whatever the neighbours leave.
  return { x1: Math.min(band.x1, place.x1), y1, x2: Math.max(band.x2, place.x2), y2 }
}

export interface CellGuideInput {
  codePoint: number
  cellId: string
  /** Fixed roles of the cell and the tag of the drawing each is shown from. */
  guideRoles: Partial<Record<HangulRole, string>>
  /** Roles already saved from strokes written in this cell. */
  writtenRoles: HangulRole[]
  stored?: StoredCellGuide
  shapes: Map<string, NormalizedShape>
  settings: CompositionSettings
  options: HangulComposeOptions
}

/**
 * The guide of one syllable cell. Stored roles are reused as they are; a role
 * whose source was rewritten is redrawn into its stored box; only a role that
 * was never shown is laid out anew. Nothing written in the cell moves a guide.
 */
export function composeCellGuide({ codePoint, cellId, guideRoles, writtenRoles, stored, shapes, settings, options }: CellGuideInput): StoredCellGuide {
  // Earlier revisions may already contain donor-driven, over-shrunk ink.
  // Rebuild them from sources once instead of scaling that damaged outline.
  if (stored?.sizingVersion !== 2) stored = undefined
  const roles = Object.keys(guideRoles) as HangulRole[]
  const result: StoredCellGuide = { sizingVersion: 2, roles: {}, placeholders: {} }
  const missing: HangulRole[] = []
  for (const role of roles) {
    const previous = stored?.roles[role]
    const source = guideRoles[role]!
    if (previous?.source === source) {
      result.roles[role] = previous
    } else if (previous) {
      const shape = guideRoleShape(codePoint, role, shapes, cellId)
      const path = shape ? guideInBox(shape, previous.box) : undefined
      result.roles[role] = path?.commands.length
        ? { source, box: previous.box, commands: toGuideCommands(path) } satisfies StoredGuideRole
        : previous
    } else {
      missing.push(role)
    }
  }
  const live = missing.length || !stored
    ? composeGuideParts(codePoint, shapes, settings, options, cellId, roles, writtenRoles)
    : undefined
  const fresh: StoredCellGuide = { roles: {}, placeholders: live?.placeholders ?? {} }
  for (const role of missing) {
    const part = live!.parts[role]
    const bounds = box(part)
    if (bounds) fresh.roles[role] = { source: guideRoles[role]!, box: bounds, commands: toGuideCommands(part) }
  }
  const sized = insetGuide(fresh)
  Object.assign(result.roles, sized.roles)
  const placeholders = stored?.placeholders ?? sized.placeholders
  for (const [role, bounds] of Object.entries(placeholders) as Array<[HangulRole, GuideBox]>) {
    if (!result.roles[role]) result.placeholders[role] = { x1: round(bounds.x1), y1: round(bounds.y1), x2: round(bounds.x2), y2: round(bounds.y2) }
  }
  const guideBoxes = Object.values(result.roles).map((entry) => entry.box)
  result.bands = {}
  for (const [role, place] of Object.entries(result.placeholders) as Array<[HangulRole, GuideBox]>) result.bands[role] = writingBand(place, guideBoxes)
  return result
}
