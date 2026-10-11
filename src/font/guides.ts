import opentype from 'opentype.js'
import { decomposeHangul, syllableRoles, type HangulRole } from './hangul'
import type { Box } from './geometry/path-ops'
import { appendShape, CELL_UNITS, type NormalizedShape } from './geometry/shape'
import { composeHangulParts, type HangulComposeOptions, type HangulParts } from './layout/compose-syllable'
import { writtenFrame } from './layout/syllable-layout'
import { selectJamoSource, sourceKey } from './layout/source-selection'
import type { CompositionSettings } from './settings'

/** An ink box in font units (1000 per cell, y up). */
export type GuideBox = Box

export interface GuideCommand { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

export interface StoredGuideRole {
  /** The source jamo drawing the outline was made from. */
  source: string
  box: GuideBox
  commands: GuideCommand[]
}

/** The fixed guide jamo of one written cell, kept exactly where they were shown. */
export interface StoredCellGuide {
  roles: Partial<Record<HangulRole, StoredGuideRole>>
  /** Where the roles still to be written were reserved. */
  placeholders: Partial<Record<HangulRole, GuideBox>>
  /** Room around each placeholder where the jamo may be written without touching a guide. */
  bands: Partial<Record<HangulRole, GuideBox>>
}

type GuideLayout = Pick<StoredCellGuide, 'roles' | 'placeholders'>

const withoutCellCache = new WeakMap<Map<string, NormalizedShape>, Map<string, Map<string, NormalizedShape>>>()

/** The sources a syllable cell had before anything was written into it. */
function shapesWithoutCell(shapes: Map<string, NormalizedShape>, cellId: string) {
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

/** The shape a fixed guide role is drawn from: the jamo captured outside the cell. */
function guideRoleShape(codePoint: number, role: HangulRole, shapes: Map<string, NormalizedShape>, cellId: string) {
  const { chars, variants } = decomposeHangul(codePoint)
  return chars[role] ? selectJamoSource(shapesWithoutCell(shapes, cellId), role, variants[role], chars[role])?.source : undefined
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
export function composeGuideParts(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions, cellId: string, guideRoles: readonly HangulRole[] = syllableRoles(codePoint), writtenRoles: readonly HangulRole[] = []): HangulParts {
  const outside = shapesWithoutCell(shapes, cellId)
  const { chars, variants } = decomposeHangul(codePoint)
  const written = writtenRoles.flatMap((role) => {
    const key = chars[role] ? sourceKey(role, variants[role], chars[role]) : ''
    const shape = shapes.get(key)
    return shape?.sourceCellId === cellId ? [{ role, key, shape }] : []
  })
  const placeholderRoles = syllableRoles(codePoint).filter((role) => !guideRoles.includes(role) && !written.some((entry) => entry.role === role))
  const sources = written.length ? new Map([...outside, ...written.map(({ key, shape }) => [key, shape] as const)]) : outside
  // A guide is the size the writer writes a syllable at, not a step toward it.
  return composeHangulParts(codePoint, sources, { ...settings, hangulNormalization: 1 }, { ...options, placeholderRoles, normalizeMinimum: 0.3 })
}

/** How much larger than the writer's own jamo a guide is shown, so the writer does not have to shrink to it. */
const GUIDE_SIZE = 1.1

/**
 * The factor that brings a composed guide, as a whole, to the size the writer
 * writes its jamo at: each guide jamo by its own drawing, each empty place by
 * the typical jamo of its role. One factor keeps the proportions the layout
 * gave the cell.
 */
function writtenFactor(live: HangulParts, codePoint: number, shapes: Map<string, NormalizedShape>, cellId: string, guideRoles: readonly HangulRole[]) {
  const { chars, variants } = decomposeHangul(codePoint)
  const outside = shapesWithoutCell(shapes, cellId)
  const boxes: Box[] = []
  const needed: number[] = []
  for (const role of syllableRoles(codePoint)) {
    const part = live.parts[role]
    const box = part.commands.length ? part.getBoundingBox() : live.placeholders[role]
    if (!box) continue
    boxes.push(box)
    const written = guideRoles.includes(role) ? guideRoleShape(codePoint, role, shapes, cellId)?.frame : writtenFrame(outside, role, variants[role], chars[role])
    const area = (box.x2 - box.x1) * (box.y2 - box.y1)
    if (written && area > 0) needed.push(Math.log(Math.sqrt(written.width * written.height * CELL_UNITS * CELL_UNITS / area)))
  }
  if (!needed.length) return 1
  const span = Math.max(1, Math.max(...boxes.map((b) => b.x2)) - Math.min(...boxes.map((b) => b.x1)), Math.max(...boxes.map((b) => b.y2)) - Math.min(...boxes.map((b) => b.y1)))
  // The guide stays inside the cell, whatever the writer's jamo fill.
  return Math.min(GUIDE_SIZE * Math.exp(needed.reduce((sum, value) => sum + value, 0) / needed.length), 900 / span)
}

/** A changed guide source drawn into the place its previous outline had. */
function guideInBox(shape: NormalizedShape, box: GuideBox) {
  const path = new opentype.Path()
  appendShape(path, shape, { x: box.x1, y: box.y1, width: Math.max(1, box.x2 - box.x1), height: Math.max(1, box.y2 - box.y1) })
  return path
}

const round = (value: number) => Math.round(value * 100) / 100
const roundBox = (box: Box): GuideBox => ({ x1: round(box.x1), y1: round(box.y1), x2: round(box.x2), y2: round(box.y2) })

/** A freshly composed guide kept inside the cell margin, at the size the writer's syllables have. */
function keepGuideInCell(guide: GuideLayout): GuideLayout {
  const boxes = [...Object.values(guide.roles).map((role) => role.box), ...Object.values(guide.placeholders)]
  // Correct an off-centre composition by moving it, never by shrinking it.
  const offset = (axis: 'x' | 'y') => {
    if (!boxes.length) return 0
    const low = Math.min(...boxes.map((b) => b[axis === 'x' ? 'x1' : 'y1']))
    const high = Math.max(...boxes.map((b) => b[axis === 'x' ? 'x2' : 'y2']))
    if (high - low > 800) return 500 - (low + high) / 2
    return low < 100 ? 100 - low : high > 900 ? 900 - high : 0
  }
  const dx = offset('x'); const dy = offset('y')
  const coordinate = (value: number, axis: 'x' | 'y') => round(value + (axis === 'x' ? dx : dy))
  const transformBox = (b: GuideBox): GuideBox => ({ x1: coordinate(b.x1, 'x'), y1: coordinate(b.y1, 'y'), x2: coordinate(b.x2, 'x'), y2: coordinate(b.y2, 'y') })
  return {
    roles: Object.fromEntries(Object.entries(guide.roles).map(([role, entry]) => [role, {
      ...entry, box: transformBox(entry.box), commands: entry.commands.map((command) => {
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

function toGuideCommands(path: opentype.Path): GuideCommand[] {
  return (path.commands as Array<Record<string, unknown>>).map((command) => {
    const result: GuideCommand = { type: String(command.type) }
    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2'] as const) {
      if (typeof command[key] === 'number') result[key] = round(command[key] as number)
    }
    return result
  })
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
function writingBand(place: GuideBox, others: GuideBox[]): GuideBox {
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
  const result = { x1: Math.min(band.x1, place.x1), y1, x2: Math.max(band.x2, place.x2), y2 }
  // A guide the grown band still reaches is cut off on the side that keeps most of the band.
  for (const other of others) {
    if (overlap(other.x1, other.x2, result.x1, result.x2) <= 0 || overlap(other.y1, other.y2, result.y1, result.y2) <= 0) continue
    const cuts: GuideBox[] = []
    if (other.y2 + BAND_MARGIN <= place.y1) cuts.push({ ...result, y1: Math.max(result.y1, other.y2 + BAND_MARGIN) })
    if (other.y1 - BAND_MARGIN >= place.y2) cuts.push({ ...result, y2: Math.min(result.y2, other.y1 - BAND_MARGIN) })
    if (other.x2 + BAND_MARGIN <= place.x1) cuts.push({ ...result, x1: Math.max(result.x1, other.x2 + BAND_MARGIN) })
    if (other.x1 - BAND_MARGIN >= place.x2) cuts.push({ ...result, x2: Math.min(result.x2, other.x1 - BAND_MARGIN) })
    const area = (b: GuideBox) => (b.x2 - b.x1) * (b.y2 - b.y1)
    const best = cuts.sort((a, b) => area(b) - area(a))[0]
    if (best) Object.assign(result, best)
  }
  // The place itself is always inside its band, whatever the neighbours leave.
  return result
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
  const roles = Object.keys(guideRoles) as HangulRole[]
  const result: StoredCellGuide = { roles: {}, placeholders: {}, bands: {} }
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
        ? { source, box: previous.box, commands: toGuideCommands(path) }
        : previous
    } else {
      missing.push(role)
    }
  }
  let live = missing.length || !stored
    ? composeGuideParts(codePoint, shapes, settings, options, cellId, roles, writtenRoles)
    : undefined
  if (live) {
    // Composed again at that factor, not scaled, so the pen keeps the width the writer wrote with.
    const scale = writtenFactor(live, codePoint, shapes, cellId, roles)
    if (Math.abs(scale - 1) > 0.01) live = composeGuideParts(codePoint, shapes, settings, { ...options, scale }, cellId, roles, writtenRoles)
  }
  const fresh: GuideLayout = { roles: {}, placeholders: live?.placeholders ?? {} }
  for (const role of missing) {
    const part = live!.parts[role]
    if (part.commands.length) fresh.roles[role] = { source: guideRoles[role]!, box: roundBox(part.getBoundingBox()), commands: toGuideCommands(part) }
  }
  const sized = keepGuideInCell(fresh)
  Object.assign(result.roles, sized.roles)
  const placeholders = stored?.placeholders ?? sized.placeholders
  for (const [role, bounds] of Object.entries(placeholders) as Array<[HangulRole, GuideBox]>) {
    if (!result.roles[role]) result.placeholders[role] = roundBox(bounds)
  }
  const guideBoxes = Object.values(result.roles).map((entry) => entry.box)
  for (const [role, place] of Object.entries(result.placeholders) as Array<[HangulRole, GuideBox]>) result.bands[role] = writingBand(place, guideBoxes)
  return result
}
