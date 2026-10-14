import opentype from 'opentype.js'
import { decomposeHangul, DOUBLE_CONSONANTS, HANGUL_ROLES, jamoParts, type HangulRole, type VowelKind } from '@/font/hangul'
import { clearanceProbe, hasInkClearance, maximizeSafeIntrusion } from '@/font/geometry/collision'
import { inkBalance, verticalAnchor } from '@/font/geometry/optical'
import { centerX as cx, centerY as cy, clamp, mapPoints, pathBounds as bounds, pathOf, pointsBox, scalePath, splitContours, translatePath, unionBox as union, type Box } from '@/font/geometry/path-ops'
import { appendShape, CELL_UNITS, combineShapesSideBySide, stretchShapeWidth, type NormalizedShape, type Zone } from '@/font/geometry/shape'
import { medianHeight } from '@/font/metrics'
import { DEFAULT_GAPS, finalGapContext, finalGapPair, gapContext, gapPair, medialGapContext, minimumGap, type GapProfile } from './gap-profile'
import { allowsOverlap, finalBoxGap } from './overlap-policy'
import { EMPTY_PROPORTIONS, jamoSize, learnedRatios, proportionContext, proportionPair, type ProportionProfile } from './proportion-profile'
import { donors, selectJamoSource, sourceKey } from './source-selection'

export interface LayoutGeometry {
  zones: Partial<Record<HangulRole, Box>>
  anchors: Partial<Record<HangulRole, { x: number; y: number }>>
  scales: Partial<Record<HangulRole, number>>
  groups: Partial<Record<HangulRole, string>>
  /** The shape the final was drawn from, once narrowed or built from parts. */
  finalShape?: NormalizedShape
}

export interface SyllableLayoutInput {
  codePoint: number
  shapes: Map<string, NormalizedShape>
  penScale: number
  /** Roles laid out as an empty box instead of ink. */
  placeholder?: ReadonlySet<HangulRole>
  scales?: Partial<Record<HangulRole, number>>
  gaps?: GapProfile
  proportions?: ProportionProfile
  /** Width / height of the average syllable the writer wrote. */
  targetAspect?: number
  /** Share of the gap of a compound final left inside a double consonant built from parts. */
  doubleConsonantGap?: number
  normalization?: SizeNormalization
}

/** Mean jamo sizes and syllable widths, per layout (`proportionContext`), in layout units. */
export interface SizeTargets {
  roles: Record<string, Partial<Record<HangulRole, number>>>
  widths: Record<string, number>
}

/** How far each jamo and the width of the syllable are drawn toward `targets`: all the way at 1, and up to 2 with a longer reach. */
export interface SizeNormalization extends Record<HangulRole, number> {
  targets: SizeTargets
  width: number
  /** Only the size of the syllable is wanted: the outlines are scaled, not made again with the pen, and may come too close. */
  draft?: boolean
}

/** Furthest a size dial at 1 rescales a jamo, and the width dial stretches a syllable, from where the layout left it. A dial at 2 reaches twice as far. */
const SIZE_REACH = 0.15
const WIDTH_REACH = 0.1
/** How much more a jamo the writer made larger than the typical one is drawn larger, in times its written excess. The pen is the same for all and hides part of the difference. */
const OWN_SIZE_EMPHASIS = 2

const stretched = new WeakMap<NormalizedShape, Map<number, NormalizedShape>>()

/** `stretchShapeWidth`, giving the same shape back for the same factor so that its outlines stay cached. */
function stretchedBy(shape: NormalizedShape, factor: number) {
  let byFactor = stretched.get(shape)
  if (!byFactor) stretched.set(shape, byFactor = new Map())
  let result = byFactor.get(factor)
  if (!result) byFactor.set(factor, result = stretchShapeWidth(shape, factor))
  return result
}

/** The size of each jamo and the width of the syllable, as the size dials compare them. */
export function layoutSizes(kind: VowelKind, parts: Record<HangulRole, opentype.Path>, penScale = 1) {
  // Measured on the pen centerline: the pen has another width in each pass of the composition.
  const pen = minimumGap / 1.5 * penScale
  const sizes: Partial<Record<HangulRole, number>> = {}
  const boxes: Box[] = []
  for (const role of HANGUL_ROLES) {
    const box = bounds(parts[role])
    if (!box) continue
    boxes.push(box)
    sizes[role] = jamoSize(role, kind, box.x2 - box.x1 - pen, box.y2 - box.y1 - pen)
  }
  const body = boxes.length ? union(boxes) : undefined
  return { sizes, width: body ? Math.max(1, body.x2 - body.x1 - pen) : 0 }
}

interface Slot {
  role: HangulRole
  shape?: NormalizedShape
  zone: Zone
  scale: number
  /** Largest size, as the square root of its ink area, the jamo may be fitted at. */
  sizeLimit: number
  /** Widest the jamo may be for its height. */
  maxAspect: number
  /** The size the writer's jamo of this role have, for a role laid out as an empty box. */
  placeholderFrame?: { width: number; height: number }
  /** Slots written together in one source cell share a group and move as one. */
  group: string
  path: opentype.Path
}

const asBox = (zone: Zone): Box => ({ x1: zone.x, y1: zone.y, x2: zone.x + zone.width, y2: zone.y + zone.height })
const contourBoxes = (path: opentype.Path): Box[] => splitContours(path).map((contour) => contour.getBoundingBox())

/** The vowel's main vertical strokes; arms and bars are not among them. */
export function verticalStem(path: opentype.Path): Box | undefined {
  const box = bounds(path)!
  const stems = contourBoxes(path).filter((b) => b.y2 - b.y1 > (box.y2 - box.y1) * 0.65 && b.x2 - b.x1 < (b.y2 - b.y1) * 0.35)
  return stems.length ? union(stems) : undefined
}

/** Widest an initial may be for its height, in aspect ratios of the typical jamo of its layout. */
const INITIAL_ASPECT_REACH = 1.25

/** Share of the height of upper body, gap and final that the upper body holds under a vertical vowel. */
const UPPER_SHARE = 0.55
/** Width the bulk of a final under a vertical vowel widens to at most, in upper body widths. */
const FINAL_BODY_SHARE = 0.29
/** Furthest an initial or a final under a vertical vowel widens, in times its width. */
const STRETCH_REACH = 1.5

/** Narrowest, in widths per height, a final built from parts is made taller. */
const COMPOUND_MIN_ASPECT = 2.0

interface TypicalJamo {
  frames: Map<string, { width: number; height: number } | undefined>
  narrowed: Map<NormalizedShape, NormalizedShape>
  widenings: Map<string, number>
}
const typicalJamo = new WeakMap<Map<string, NormalizedShape>, TypicalJamo>()

function typicalOf(shapes: Map<string, NormalizedShape>) {
  let typical = typicalJamo.get(shapes)
  if (!typical) typicalJamo.set(shapes, typical = { frames: new Map(), narrowed: new Map(), widenings: new Map() })
  return typical
}

/** Median width and height, in cell fractions, of the jamo written for the layout of source `key`. A double consonant built from parts stands in for the written one. */
function typicalFrame(shapes: Map<string, NormalizedShape>, key: string) {
  const layout = key.slice(0, key.lastIndexOf(':') + 1)
  if (!layout) return undefined
  const { frames } = typicalOf(shapes)
  if (!frames.has(layout)) {
    const written = [...shapes].filter(([source, shape]) => source.startsWith(layout) && (!shape.synthesized || source.slice(layout.length) in DOUBLE_CONSONANTS)).map(([, shape]) => shape.frame)
    const width = medianHeight(written.map((f) => f.width), 0); const height = medianHeight(written.map((f) => f.height), 0)
    frames.set(layout, width > 0 && height > 0 ? { width, height } : undefined)
  }
  return frames.get(layout)
}

/** How many times wider for its height the writer makes a jamo in the layout of key `to` than in that of key `from`: the median over the jamo written in both, in whole percents. */
function layoutWidening(shapes: Map<string, NormalizedShape>, from: string, to: string) {
  const source = from.slice(0, from.lastIndexOf(':') + 1); const target = to.slice(0, to.lastIndexOf(':') + 1)
  if (!source || source === target) return 1
  const { widenings } = typicalOf(shapes)
  let widening = widenings.get(source + target)
  if (widening === undefined) {
    const both = [...shapes].flatMap(([key, shape]) => {
      const other = key.startsWith(source) && !shape.synthesized ? shapes.get(target + key.slice(source.length)) : undefined
      return other && !other.synthesized ? [other.aspectRatio / shape.aspectRatio] : []
    })
    widenings.set(source + target, widening = Math.round(clamp(medianHeight(both, 1), 1 / STRETCH_REACH, STRETCH_REACH) * 100) / 100)
  }
  return widening
}

/** Width and height of the jamo as the writer wrote it, else the median of the nearest layout that has some. */
export function writtenFrame(shapes: Map<string, NormalizedShape>, role: HangulRole, variant: number, char: string) {
  for (const candidate of [variant, ...donors(role, variant)]) {
    const own = shapes.get(sourceKey(role, candidate, char))
    if (own && !own.synthesized) return { width: own.frame.width, height: own.frame.height }
  }
  for (const candidate of [variant, ...donors(role, variant)]) {
    const frame = typicalFrame(shapes, sourceKey(role, candidate, char))
    if (frame) return frame
  }
  return undefined
}

/** `shape` narrowed to `maxAspect` (width / height), its height kept. */
function narrowedTo(shapes: Map<string, NormalizedShape>, shape: NormalizedShape, maxAspect: number) {
  if (shape.aspectRatio <= maxAspect) return shape
  const { narrowed } = typicalOf(shapes)
  let result = narrowed.get(shape)
  if (!result) narrowed.set(shape, result = stretchShapeWidth(shape, maxAspect / shape.aspectRatio))
  return result
}

/** A jamo where it was drawn: its outline, and the shape and cell scale the outline was made from. */
export interface PlacedJamo {
  path: opentype.Path
  shape?: NormalizedShape
  /** Cell widths of the shape per `CELL_UNITS` of the outline. */
  scale?: number
}

/**
 * Where a final's centre sits between the left of the upper body and the
 * right of the vowel's stem. Not the middle: the stem is the edge the eye
 * holds the final against, while the initial's side is open.
 */
export const STEM_SHARE = 0.6
/** Furthest the bulk of a final may reach past either side of the upper body, in upper body widths. */
const FINAL_OVERHANG = 0.05
/** Furthest a final's visual centre may sit from the centre of its box, in box widths. */
const ANCHOR_REACH = 0.25
/** Furthest a learned sideways offset may move a final, in upper body widths. */
const CROSS_OFFSET_REACH = 0.06

/** Share of the distance from the middle of an initial's box to the middle of its body that the initial is aligned by. */
const BODY_SHARE = 0.6

const inkScale = (jamo: PlacedJamo) => jamo.shape ? CELL_UNITS * (jamo.scale ?? 0) : 0

/**
 * How far below the middle of its box the body of an initial beside a vertical
 * vowel sits, in outline units: the part that reads as its vertical centre. A
 * tick above ㅎ does not pull the body down.
 */
export function initialBodyDrop(shape: NormalizedShape, scale: number) {
  return verticalAnchor(shape) * CELL_UNITS * scale * BODY_SHARE
}

export function initialAnchorY(initial: PlacedJamo) {
  return cy(bounds(initial.path)!) - (initial.shape ? initialBodyDrop(initial.shape, initial.scale ?? 0) : 0)
}

/**
 * The point of a final that reads as its centre: the middle of the bulk of
 * its ink, so a tick reaching out of ㅂ does not push its body off centre.
 */
export function finalAnchorX(final: PlacedJamo) {
  const f = bounds(final.path)!
  const reach = (f.x2 - f.x1) * ANCHOR_REACH
  return cx(f) + clamp(final.shape ? inkBalance(final.shape).core * inkScale(final) : 0, -reach, reach)
}

/** Width of the bulk of a final's ink, never more than its box. */
function finalBulk(final: PlacedJamo) {
  const f = bounds(final.path)!
  return final.shape ? Math.min(f.x2 - f.x1, inkBalance(final.shape).span * inkScale(final)) : f.x2 - f.x1
}

/**
 * Where the visual centre of the final belongs under the upper pair: under a
 * vowel with a stem on the right, a fixed share of the way from the left of
 * the body to the right of the stem, whatever arms the vowel has; under a
 * vowel without one, the middle of the body.
 */
export function finalTargetX(kind: VowelKind, initial: PlacedJamo | undefined, medial: PlacedJamo | undefined) {
  const i = initial && bounds(initial.path); const m = medial && bounds(medial.path)
  const body = union([i, m].filter((box): box is Box => Boolean(box)))
  const stem = !medial || !m ? undefined : kind === 'vertical' ? verticalStem(medial.path) : kind === 'mixed' ? medialSpace(medial.path)?.vertical : undefined
  return stem ? body.x1 + (stem.x2 - body.x1) * STEM_SHARE : cx(body)
}

function hasLargeLoop(shape: NormalizedShape | undefined) {
  const points = shape?.strokes.flatMap((stroke) => stroke.centerline.points) ?? []
  if (points.length < 4) return false
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1])
  const x1 = Math.min(...xs); const y1 = Math.min(...ys)
  const width = Math.max(...xs) - x1; const height = Math.max(...ys) - y1
  if (width <= 0 || height <= 0) return false
  const span = (list: typeof points, axis: 0 | 1) => list.length ? Math.max(...list.map((p) => p[axis])) - Math.min(...list.map((p) => p[axis])) : 0
  // An enclosing frame may be written in several strokes. Measure its four
  // sides together instead of requiring one artificially closed pen path.
  return span(points.filter((p) => p[1] < y1 + height * 0.2), 0) > width * 0.7
    && span(points.filter((p) => p[1] > y1 + height * 0.8), 0) > width * 0.7
    && span(points.filter((p) => p[0] < x1 + width * 0.2), 1) > height * 0.7
    && span(points.filter((p) => p[0] > x1 + width * 0.8), 1) > height * 0.7
}

/** Space budgets, not target aspect ratios. Empty space is allowed. */
function spaces(kind: VowelKind, final: boolean): Record<HangulRole, Zone> {
  if (kind === 'vertical') return {
    initial: { x: 80, y: final ? 440 : 180, width: 380, height: final ? 400 : 650 },
    medial: { x: 510, y: final ? 420 : 140, width: 390, height: final ? 450 : 720 },
    final: { x: 150, y: 90, width: 700, height: 340 },
  }
  if (kind === 'mixed') return {
    initial: { x: 130, y: final ? 610 : 510, width: 340, height: final ? 280 : 360 },
    medial: { x: 110, y: final ? 350 : 230, width: 660, height: final ? 370 : 520 },
    final: { x: 110, y: 90, width: 560, height: 260 },
  }
  return {
    initial: { x: 150, y: final ? 620 : 500, width: 700, height: final ? 240 : 350 },
    medial: { x: 100, y: final ? 370 : 160, width: 800, height: final ? 210 : 290 },
    final: { x: 150, y: 80, width: 700, height: 310 },
  }
}

/** Landmarks only: the compound medial always receives one similarity transform. */
export function medialSpace(path: opentype.Path): { horizontal: Box; vertical: Box; rise?: Box } | undefined {
  const body = bounds(path)
  if (!body) return undefined
  const boxes = contourBoxes(path)
  const tall = boxes.filter((box) => cx(box) > body.x1 + (body.x2 - body.x1) * 0.4
    && box.y2 - box.y1 > (body.y2 - body.y1) * 0.45 && box.x2 - box.x1 < (box.y2 - box.y1) * 0.5)
  // A long stem hanging from ㅜ is still part of the left compartment: only
  // strokes about as tall as the tallest one are the vowel's main stems.
  const tallest = Math.max(...tall.map((box) => box.y2 - box.y1))
  const stems = tall.filter((box) => box.y2 - box.y1 >= tallest * 0.7)
  if (stems.length) {
    const vertical = union(stems)
    const left = boxes.filter((box) => !stems.includes(box) && cx(box) < vertical.x1)
    const base = [...left].sort((a, b) => (b.x2 - b.x1) - (a.x2 - a.x1))[0]
    if (base) {
      const part = left.filter((box) => box.x2 <= base.x2 + (body.x2 - body.x1) * 0.04)
      const horizontal = union(part)
      // The short stroke of ㅗ: it stands on the bar, where that of ㅜ hangs from it.
      const rise = part.find((box) => box !== base && box.y2 - box.y1 > box.x2 - box.x1 && box.y2 - base.y2 > base.y1 - box.y1)
      return { horizontal, vertical, rise }
    }
  }
  const cutoff = body.x1 + (body.x2 - body.x1) * 0.62
  const points = path.commands.flatMap((c) => 'x' in c ? [[c.x, c.y] as const] : [])
  const left = points.filter(([x]) => x <= cutoff); const right = points.filter(([x]) => x > cutoff)
  return left.length && right.length ? { horizontal: pointsBox(left), vertical: pointsBox(right) } : undefined
}

function rectangle(path: opentype.Path, z: Zone) {
  path.moveTo(z.x, z.y); path.lineTo(z.x + z.width, z.y); path.lineTo(z.x + z.width, z.y + z.height); path.lineTo(z.x, z.y + z.height); path.close()
}

/** Draws `shape` at `scale` cell units per cell, with its ink centred on (x, y). */
function appendCentered(path: opentype.Path, shape: NormalizedShape, x: number, y: number, scale: number, penScale: number) {
  const f = shape.frame
  appendShape(path, shape, {
    x: x - (f.x + f.width / 2) * CELL_UNITS * scale,
    y: y - (1 - f.y - f.height / 2) * CELL_UNITS * scale,
    width: CELL_UNITS * scale,
    height: CELL_UNITS * scale,
  }, true, penScale)
}

export function layoutSyllable(input: SyllableLayoutInput) {
  const { kind, chars, variants, finalIndex } = decomposeHangul(input.codePoint)
  const hasFinal = finalIndex > 0
  const zones = spaces(kind, hasFinal)
  const gaps = input.gaps ?? DEFAULT_GAPS
  const char = String.fromCodePoint(input.codePoint)
  const ratios = learnedRatios(input.proportions ?? EMPTY_PROPORTIONS, char, proportionPair(chars.initial, chars.medial, chars.final || undefined), proportionContext(kind, hasFinal))
  const isPlaceholder = (role: HangulRole) => Boolean(input.placeholder?.has(role))

  const slots = HANGUL_ROLES.filter((role) => role !== 'final' || hasFinal).map((role): Slot => {
    // Unwritten roles reserve neutral space. Donor ink must not determine the
    // placeholder size or become a size reference for a visible guide jamo.
    const selected = isPlaceholder(role) ? undefined : selectJamoSource(input.shapes, role, variants[role], chars[role])
    // An initial borrowed from another layout takes the width the writer gives a jamo in this one.
    const widening = role === 'initial' && selected?.match === 'derived' ? layoutWidening(input.shapes, selected.key, sourceKey(role, variants[role], chars[role])) : 1
    const shape = selected && widening !== 1 ? stretchedBy(selected.source, widening) : selected?.source
    const group = selected?.match === 'exact' && shape && !shape.synthesized && shape.sourceCellId ? shape.sourceCellId : role
    // The initial is the size reference of the other jamo: it is held to the
    // size the typical initial of its layout has when that one fills the zone,
    // so one written flat or narrow is not enlarged past the others.
    const written = role === 'initial' && selected ? typicalFrame(input.shapes, selected.key) : undefined
    const typical = written && { ...written, width: written.width * widening }
    const sizeLimit = typical ? Math.min(zones[role].width / typical.width, zones[role].height / typical.height) * Math.sqrt(typical.width * typical.height) : Infinity
    const maxAspect = typical ? typical.width / typical.height * INITIAL_ASPECT_REACH : Infinity
    const placeholderFrame = isPlaceholder(role) ? writtenFrame(input.shapes, role, variants[role], chars[role]) : undefined
    return { role, shape, zone: zones[role], scale: input.scales?.[role] ?? 1, sizeLimit, maxAspect, placeholderFrame, group, path: new opentype.Path() }
  })
  const byRole = Object.fromEntries(slots.map((slot) => [slot.role, slot])) as Partial<Record<HangulRole, Slot>>
  // Only the upper pair is recombined as written. A final captured with the
  // initial alone would drag it below the vowel it is set under.
  if (byRole.final && byRole.initial?.group === byRole.final.group && byRole.medial?.group !== byRole.final.group) {
    byRole.initial.group = 'initial'; byRole.final.group = 'final'
  }
  const groups = new Map<string, Slot[]>()
  for (const slot of slots) groups.set(slot.group, [...(groups.get(slot.group) ?? []), slot])
  const geometry: LayoutGeometry = { zones: {}, anchors: {}, scales: {}, groups: {} }
  // A free-standing jamo far wider for its height than the others of its
  // layout is narrowed, not shrunk, so its syllable stays as tall as theirs.
  for (const slot of slots) {
    if (slot.shape && groups.get(slot.group)!.length === 1) slot.shape = narrowedTo(input.shapes, slot.shape, slot.maxAspect)
  }

  // Jamo written together keep their arrangement under one scale; every other
  // jamo is fitted into its own space.
  for (const members of groups.values()) {
    const target = union(members.map((slot) => asBox(slot.zone)))
    const native = members.length > 1 ? union(members.map((slot) => {
      const f = slot.shape!.frame
      return { x1: f.x * CELL_UNITS, y1: (1 - f.y - f.height) * CELL_UNITS, x2: (f.x + f.width) * CELL_UNITS, y2: (1 - f.y) * CELL_UNITS }
    })) : undefined
    const common = native ? Math.min((target.x2 - target.x1) / Math.max(1, native.x2 - native.x1), (target.y2 - target.y1) / Math.max(1, native.y2 - native.y1)) : 1
    for (const slot of members) {
      const shape = slot.shape
      if (native) {
        const scale = common * Math.min(...members.map((m) => m.scale))
        appendShape(slot.path, shape!, { x: cx(target) - cx(native) * scale, y: cy(target) - cy(native) * scale, width: CELL_UNITS * scale, height: CELL_UNITS * scale }, true, input.penScale)
        geometry.scales[slot.role] = scale
      } else if (shape) {
        const width = Math.max(1, shape.frame.width * CELL_UNITS); const height = Math.max(1, shape.frame.height * CELL_UNITS)
        const fit = Math.min(slot.zone.width / width, slot.zone.height / height, slot.sizeLimit / Math.sqrt(width * height))
        const scale = fit * slot.scale
        appendCentered(slot.path, shape, slot.zone.x + slot.zone.width / 2, slot.zone.y + slot.zone.height / 2, scale, input.penScale)
        geometry.scales[slot.role] = scale
      }
      if (isPlaceholder(slot.role)) {
        const box = bounds(slot.path); slot.path = new opentype.Path()
        const frame = slot.placeholderFrame
        const width = frame ? frame.width * CELL_UNITS : slot.zone.width * 0.6
        const height = frame ? frame.height * CELL_UNITS : slot.zone.height * 0.6
        // The empty box is fitted like a written jamo of the typical size.
        const fit = frame ? Math.min(slot.zone.width / width, slot.zone.height / height) * slot.scale : 1
        rectangle(slot.path, box ? { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 } : { x: slot.zone.x + (slot.zone.width - width * fit) / 2, y: slot.zone.y + (slot.zone.height - height * fit) / 2, width: width * fit, height: height * fit })
      }
    }
  }
  const release = (id: string, members: Slot[]) => {
    groups.delete(id)
    for (const slot of members) { slot.group = slot.role; groups.set(slot.group, [slot]) }
  }
  // A captured arrangement is a preference, not permission to retain crossing
  // ink. Release only unsafe groups; their jamo keep their similarity transforms.
  for (const [id, members] of [...groups]) {
    const unsafe = members.some((a, index) => members.slice(index + 1).some((b) => !hasInkClearance(a.path, b.path, minimumGap / 3)))
    if (unsafe) release(id, members)
  }

  /** Rescales a free-standing jamo about its centre, rebuilding its outline so the pen does not scale with it. */
  const resize = (slot: Slot, correction: number) => {
    if ((!slot.shape && !slot.placeholderFrame) || groups.get(slot.group)!.length > 1) return
    const box = bounds(slot.path)!
    if (!slot.shape) { scalePath(slot.path, correction, { x: cx(box), y: cy(box) }); return }
    const scale = geometry.scales[slot.role]! * correction
    slot.path = new opentype.Path()
    appendCentered(slot.path, slot.shape, cx(box), cy(box), scale, input.penScale)
    geometry.scales[slot.role] = scale
  }
  // Apply learned proportions to the already fitted sizes, not the source-cell extents.
  // An empty initial the size of the writer's typical one is a reference as good as a written one.
  if (byRole.initial && (!isPlaceholder('initial') || byRole.initial.placeholderFrame) && bounds(byRole.initial.path) && ratios) {
    const i = bounds(byRole.initial.path)!
    const size = (role: HangulRole, box: Box) => jamoSize(role, kind, box.x2 - box.x1 - minimumGap / 1.5 * 2, box.y2 - box.y1 - minimumGap / 1.5 * 2)
    for (const role of ['medial', 'final'] as const) {
      const slot = byRole[role]; const wanted = ratios[role]
      if ((!slot?.shape && !slot?.placeholderFrame) || wanted === undefined || slot.group === byRole.initial.group || groups.get(slot.group)!.length > 1) continue
      const box = bounds(slot.path)!
      const capacity = Math.min(slot.zone.width / (box.x2 - box.x1), slot.zone.height / (box.y2 - box.y1))
      const correction = Math.max(0.25, Math.min(capacity, 2, wanted * size('initial', i) / Math.max(1, size(role, box))))
      resize(slot, correction)
    }
  }

  const move = (slot: Slot, dx: number, dy: number) => { for (const m of groups.get(slot.group)!) translatePath(m.path, dx, dy) }
  const initial = byRole.initial; const medial = byRole.medial; const final = byRole.final
  // Feedback concerns recombined syllables. Fully captured words keep their
  // authored balance; the upper pair can also retain its common coordinates.
  if (hasFinal && initial && medial && final && bounds(medial.path) && bounds(final.path) && initial.shape?.sourceCellId) {
    const members = groups.get(final.group)!
    if (members.length === 2 && !members.includes(initial)) release(final.group, members)
    const i = bounds(initial.path)
    if (i && kind === 'vertical') {
      resize(initial, 0.83)
      resize(final, 0.82)
      // Parallel vowel stems need less width in a closed syllable, while a
      // single stem keeps its original height and aspect ratio.
      const m = bounds(medial.path)!
      const stems = contourBoxes(medial.path).filter((b) => b.y2 - b.y1 > (m.y2 - m.y1) * 0.7)
      if (stems.length > 1) resize(medial, 0.84)
    } else if (i && kind === 'mixed' && hasLargeLoop(final.shape)) {
      resize(final, 0.7)
    } else if (i && kind !== 'mixed') {
      const aspect = (i.x2 - i.x1) / (i.y2 - i.y1)
      resize(initial, kind === 'horizontalUp' ? clamp(1.45 - 0.34 * aspect, 0.89, 1.16) : 0.92)
      const f = bounds(final.path)!
      resize(final, kind === 'horizontalDown' ? clamp((f.y2 - f.y1) / (f.x2 - f.x1) * 1.4, 1, 1.43) : 0.94)
    }
  }
  if (kind === 'mixed' && initial && medial && initial.group !== medial.group) {
    const space = medialSpace(medial.path); const m = bounds(medial.path); const i = bounds(initial.path)
    if (space && m && i) {
      // The left compartment may extend above the right stem; matching its
      // literal headroom would turn a handwritten consonant into a dot.
      const height = Math.max(m.y2 - space.horizontal.y2, (m.y2 - m.y1) * 0.65)
      const width = Math.max(space.vertical.x1 - m.x1, (m.x2 - m.x1) * 0.55)
      resize(initial, Math.min(1, height / (i.y2 - i.y1), width / (i.x2 - i.x1)))
    }
  }
  const upperSlots = () => [initial, medial].filter((slot): slot is Slot => Boolean(slot && bounds(slot.path)))
  if (final) {
    const upper = upperSlots()
    const f = bounds(final.path)
    if (upper.length && f) {
      const body = union(upper.map((slot) => bounds(slot.path)!))
      resize(final, Math.min(1, (body.x2 - body.x1) * 0.85 / (f.x2 - f.x1)))
    }
  }

  const upperPlacement = gaps.initialMedialSyllables[char] ?? gaps.initialMedialPairs[gapPair(chars.initial, chars.medial, hasFinal)]
  const upperGap = upperPlacement?.advanceGap ?? gaps.medialContexts[medialGapContext(chars.medial, hasFinal)] ?? gaps.contexts[gapContext(kind, hasFinal)] ?? gaps[kind]
  const finalPlacement = gaps.medialFinalSyllables[char] ?? gaps.medialFinalPairs[finalGapPair(chars.medial, chars.final)]
  const finalGap = finalPlacement?.advanceGap ?? gaps.finalContexts[finalGapContext(kind, chars.final)] ?? gaps.final
  /** The room a final under a vertical vowel has beside an upper body, with the gap above it. */
  const stackGap = (vowelHeight: number) => Math.min(Math.max(minimumGap, finalGap), vowelHeight * 0.1)
  const finalRoom = (upperHeight: number, vowelHeight: number) => upperHeight * (1 - UPPER_SHARE) / UPPER_SHARE - stackGap(vowelHeight)
  // A closed syllable fitted by height alone is narrower than the writer's
  // average. Its initial widens, keeping its height, until the syllable reaches that aspect.
  if (input.targetAspect && kind === 'vertical' && initial?.shape && medial && final?.shape && groups.get(initial.group)!.length === 1 && !isPlaceholder('initial')) {
    const m = bounds(medial.path); const f = bounds(final.path)
    if (m && f && bounds(initial.path)) {
      // The pen does not widen with the jamo, so one correction falls short.
      let widened = 1
      for (let pass = 0; pass < 3; pass += 1) {
        const i = bounds(initial.path)!
        const vowelHeight = m.y2 - m.y1; const upperHeight = Math.max(vowelHeight, i.y2 - i.y1)
        const height = upperHeight + stackGap(vowelHeight) + Math.min(f.y2 - f.y1, finalRoom(upperHeight, vowelHeight))
        const width = input.targetAspect * height - (m.x2 - m.x1) - Math.max(minimumGap, upperGap)
        const factor = Math.min(STRETCH_REACH / widened, initial.zone.width / (i.x2 - i.x1), width / (i.x2 - i.x1))
        if (factor > 1.01) { initial.shape = stretchShapeWidth(initial.shape, factor); resize(initial, 1); widened *= factor }
      }
    }
  }
  if (initial && medial && initial.group !== medial.group) {
    const i = bounds(initial.path); const m = bounds(medial.path)
    if (i && m) {
      const space = kind === 'mixed' ? medialSpace(medial.path) : undefined
      const anchor = space ? { ...space.horizontal, x1: m.x1, x2: space.vertical.x1 } : m
      const cross = upperPlacement?.crossOffset ?? 0
      if (kind === 'vertical') {
        const placedInitial = { path: initial.path, shape: isPlaceholder('initial') ? undefined : initial.shape, scale: geometry.scales.initial }
        move(initial, m.x1 - i.x2 - Math.max(minimumGap, upperGap), cy(m) - initialAnchorY(placedInitial) - cross)
      }
      else if (kind === 'mixed') {
        const headroom = clamp(((i.y2 - i.y1) / (i.x2 - i.x1) - 0.65) / 0.4, 0, 1)
        // The initial stands over the short stroke of ㅗ, as far as the stem leaves it room.
        const x = space?.rise ? Math.min(cx(space.rise), anchor.x2 - minimumGap - (i.x2 - i.x1) / 2) : anchor.x1 + (anchor.x2 - anchor.x1) * 0.35
        move(initial, x - cx(i) - cross, m.y2 - i.y2 + (i.y2 - i.y1) * 0.45 * headroom)
      }
      else move(initial, cx(anchor) - cx(i) - cross, anchor.y2 - i.y1 + Math.max(minimumGap, upperGap))
    }
  }

  const inkClearance = minimumGap * (kind === 'mixed' ? 0.2 : 0.8)
  /** Moves `moving` away from `fixed` until their ink is clear, then back in by at most `maximum` while it stays clear. */
  const separate = (fixed: Slot[], moving: Slot, axis: 'x' | 'y' | 'corner', direction: -1 | 1, maximum = 0, clearance = inkClearance) => {
    const stationary = fixed.filter((slot) => slot.group !== moving.group && slot.path.commands.length)
    if (!stationary.length || !moving.path.commands.length) return
    const path = pathOf(stationary.flatMap((slot) => slot.path.commands))
    const movingPath = pathOf(groups.get(moving.group)!.flatMap((slot) => slot.path.commands))
    // Search around the preferred corner instead of forcing every conflict
    // along one diagonal, which used to eject the initial above the syllable.
    // Both outlines are prepared once; every candidate position is a shift of the moving one.
    const clear = clearanceProbe(path, movingPath, clearance)
    if (axis === 'corner' && !clear(0, 0)) {
      const directions = [[-1, 0], [0, 1], [0, -1], [-Math.SQRT1_2, Math.SQRT1_2], [1, 0]]
      for (let radius = clearance; radius <= 1200; radius += clearance) {
        for (const [x, y] of directions) {
          if (clear(radius * x, radius * y)) { move(moving, radius * x, radius * y); return }
        }
      }
    }
    const stepX = axis !== 'y' ? direction * clearance : 0
    const stepY = axis === 'corner' ? -direction * clearance : axis === 'y' ? direction * clearance : 0
    let steps = 0
    while (!clear(steps * stepX, steps * stepY) && steps * clearance < 1200) steps += 1
    for (let step = 0; step < steps; step += 1) move(moving, stepX, stepY)
    if (maximum > 0 && axis !== 'corner') {
      const intrusion = maximizeSafeIntrusion(path, movingPath, { axis, direction: -direction as -1 | 1, clearance, maximum, step: clearance })
      move(moving, axis === 'x' ? -direction * intrusion : 0, axis === 'y' ? -direction * intrusion : 0)
    }
  }
  if (initial && medial && initial.group !== medial.group) {
    // An empty compound-vowel box is not ink: the initial stays in its upper left compartment.
    if (kind === 'mixed') { if (!isPlaceholder('medial')) separate([medial], initial, 'corner', -1) }
    else {
      // A pair the writer has sampled already carries its own overlap.
      const notch = !upperPlacement && allowsOverlap('initial-medial', chars.initial, chars.medial) ? 90 : 0
      // Interlocking ink keeps the same gap as jamo that merely sit side by side.
      separate([initial], medial, kind === 'vertical' ? 'x' : 'y', kind === 'vertical' ? 1 : -1, Math.max(0, minimumGap - upperGap) + notch, minimumGap)
    }
  }
  // A final under a vertical vowel is flattened, not shrunk, until the upper
  // body holds `UPPER_SHARE` of the height of the upper body, the gap and the final.
  if (kind === 'vertical' && final?.shape && groups.get(final.group)!.length === 1 && !isPlaceholder('final')) {
    const upper = upperSlots()
    if (upper.length && bounds(final.path)) {
      const body = union(upper.map((slot) => bounds(slot.path)!))
      const m = medial && bounds(medial.path)
      const room = finalRoom(body.y2 - body.y1, m ? m.y2 - m.y1 : body.y2 - body.y1)
      // The pen does not shrink with the jamo, so one correction falls short.
      for (let pass = 0; pass < 3; pass += 1) {
        const fitted = bounds(final.path)!
        const factor = Math.min(1, room / (fitted.y2 - fitted.y1))
        if (factor < 1) { final.shape = stretchShapeWidth(final.shape, 1 / factor); resize(final, factor) }
      }
    }
  }
  // A final built from parts has no written width: it stays within 90% of the
  // settled upper body, narrowing its wider part before shrinking as a whole.
  if (final?.shape?.synthesized && jamoParts(chars.final)) {
    const upper = upperSlots(); const f = bounds(final.path)
    if (upper.length && f) {
      const body = union(upper.map((slot) => bounds(slot.path)!))
      const limit = (body.x2 - body.x1) * 0.9
      const m = medial && bounds(medial.path)
      const height = kind === 'vertical' ? Math.min(final.zone.height, finalRoom(body.y2 - body.y1, m ? m.y2 - m.y1 : body.y2 - body.y1)) : final.zone.height
      const [left, right] = jamoParts(chars.final)!.map((part) => input.shapes.get(sourceKey('final', 0, part)))
      if (f.x2 - f.x1 > limit && left && right) {
        final.shape = { ...combineShapesSideBySide(left, right, limit / (f.y2 - f.y1), chars.final in DOUBLE_CONSONANTS ? input.doubleConsonantGap ?? 0 : 1), sourceRole: 'final' }
        resize(final, 1)
      }
      // The pen does not shrink with the jamo, so one correction falls short.
      for (let pass = 0; pass < 3; pass += 1) {
        const fitted = bounds(final.path)!
        resize(final, Math.min(1, limit / (fitted.x2 - fitted.x1)))
      }
      // The width limit shrank the whole final: it is made taller again, its width kept.
      for (let pass = 0; pass < 3; pass += 1) {
        const fitted = bounds(final.path)!
        const width = fitted.x2 - fitted.x1; const current = fitted.y2 - fitted.y1
        const factor = Math.min(height, width / COMPOUND_MIN_ASPECT) / current
        if (factor > 1.01) { final.shape = stretchShapeWidth(final.shape, 1 / factor); resize(final, factor) }
      }
    }
  }
  // A written final wider than 90% of the settled upper body is narrowed, not
  // shrunk: it keeps its height, so it does not read as a smaller jamo. With a
  // target aspect, a narrower final under a vertical vowel widens to it, as far as `STRETCH_REACH`.
  if (final?.shape && !final.shape.synthesized && groups.get(final.group)!.length === 1 && !isPlaceholder('final')) {
    const upper = upperSlots()
    if (upper.length && bounds(final.path)) {
      const body = union(upper.map((slot) => bounds(slot.path)!))
      // The pen does not narrow with the jamo, so one correction falls short.
      let widened = 1
      for (let pass = 0; pass < 3; pass += 1) {
        const fitted = bounds(final.path)!
        const fit = (body.x2 - body.x1) * 0.9 / (fitted.x2 - fitted.x1)
        // A tick running past the body is not counted: only the bulk of the ink is measured.
        const bulkFit = (body.x2 - body.x1) * FINAL_BODY_SHARE / Math.max(1, finalBulk({ path: final.path, shape: final.shape, scale: geometry.scales.final }))
        const factor = kind === 'vertical' && input.targetAspect ? Math.min(STRETCH_REACH / widened, fit, Math.max(1, bulkFit)) : Math.min(1, fit)
        if (factor < 1 || factor > 1.01) { final.shape = stretchShapeWidth(final.shape, factor); resize(final, 1); widened *= factor }
      }
    }
  }
  // The final hangs from the upper pair where it settled, not where it started.
  if (final) {
    const f = bounds(final.path); const upper = upperSlots()
    if (f && upper.length) {
      const body = union(upper.map((slot) => bounds(slot.path)!))
      const anchor = kind === 'mixed' && medial ? medialSpace(medial.path)?.horizontal ?? body : body
      const m = medial && bounds(medial.path)
      const i = initial && bounds(initial.path)
      const placed = (slot: Slot | undefined): PlacedJamo | undefined => slot && bounds(slot.path)
        ? { path: slot.path, shape: isPlaceholder(slot.role) ? undefined : slot.shape, scale: geometry.scales[slot.role] } : undefined
      const spaceGap = Math.min(Math.max(minimumGap, finalGap), (m ? m.y2 - m.y1 : body.y2 - body.y1) * 0.1)
      if (!upper.some((slot) => slot.group === final.group)) {
        const self = placed(final)!
        // What the writer adds to the rule is a nuance, not a second rule.
        const nuance = (body.x2 - body.x1) * CROSS_OFFSET_REACH
        const centre = finalAnchorX(self)
        const dx = finalTargetX(kind, placed(initial), placed(medial)) - centre + clamp(finalPlacement?.crossOffset ?? 0, -nuance, nuance)
        // The bulk of the final stays under the body; only the thin end of a
        // stroke may reach further past it.
        const overhang = (body.x2 - body.x1) * FINAL_OVERHANG; const half = finalBulk(self) / 2
        const sides = [body.x1 - overhang - (centre - half), body.x2 + overhang - (centre + half)]
        move(final, clamp(dx, Math.min(...sides), Math.max(...sides)), anchor.y1 - f.y2 - spaceGap)
      }
      else if (initial && medial && initial.group !== final.group && medial.group === final.group && kind === 'vertical') {
        // A slot can exist before its source jamo has been written.
        if (i) move(initial, 2 * cx(f) - body.x2 - i.x1, 0)
      }
    }
  }
  if (final) {
    const floor = finalBoxGap(chars.medial, chars.final)
    const notch = floor < 0 ? 90 : 0
    separate([initial, medial].filter((slot): slot is Slot => Boolean(slot)), final, 'y', -1, Math.max(0, minimumGap - finalGap) + notch)
    // Clear ink is not enough: the final's box stays below the upper body's
    // box, or enters it only as far as an interlocking pair may, whatever
    // gap was learned.
    const fixed = upperSlots().filter((slot) => slot.group !== final.group)
    const f = bounds(final.path)
    if (f && fixed.length) {
      const upper = union(fixed.map((slot) => bounds(slot.path)!))
      if (f.y2 > upper.y1 - floor) move(final, 0, upper.y1 - floor - f.y2)
    }
  }

  // The size dials act last, on the settled layout: an earlier correction is taken back by the rules above.
  const dial = input.normalization
  const inked = dial ? slots.filter((slot) => slot.shape && !isPlaceholder(slot.role) && bounds(slot.path)) : []
  if (dial && inked.length) {
    const context = proportionContext(kind, hasFinal)
    const pen = minimumGap / 1.5 * input.penScale
    // Everything is planned on the boxes of the pen centerlines, and each jamo is then outlined once.
    const lines = inked.map((slot): Box => {
      const box = bounds(slot.path)!
      return { x1: box.x1 + pen / 2, y1: box.y1 + pen / 2, x2: Math.max(box.x1 + pen / 2 + 1, box.x2 - pen / 2), y2: Math.max(box.y1 + pen / 2 + 1, box.y2 - pen / 2) }
    })
    /** Past 1 a dial does not draw further than the target: it reaches further for it. */
    const toward = (strength: number, ratio: number, reach: number) => strength > 0 ? clamp(1 + Math.min(1, strength) * (ratio - 1), 1 - reach * Math.max(1, strength), 1 + reach * Math.max(1, strength)) : 1
    /** How large the writer's own jamo is against the typical one of its layout: ㅎ is written larger than ㅇ, and stays so. */
    const ownSize = (role: HangulRole) => {
      if (role === 'medial') return 1
      const own = writtenFrame(input.shapes, role, variants[role], chars[role])
      const typical = typicalFrame(input.shapes, sourceKey(role, variants[role], chars[role]))
      return own && typical ? clamp(1 + (Math.sqrt(own.width * own.height / (typical.width * typical.height)) - 1) * OWN_SIZE_EMPHASIS, 1 - SIZE_REACH * 2, 1 + SIZE_REACH * 2) : 1
    }
    const plans = inked.map((slot, index) => {
      const box = lines[index]
      const mean = dial.targets.roles[context]?.[slot.role]
      const target = mean && mean * ownSize(slot.role)
      const correction = target ? toward(dial[slot.role], target / jamoSize(slot.role, kind, box.x2 - box.x1, box.y2 - box.y1), SIZE_REACH) : 1
      // A jamo grows away from the others: the side of its box that faces them stays where it is.
      const rest = lines.filter((_, other) => other !== index)
      const facing = rest.length ? union(rest) : box
      return { box, correction: Math.abs(correction - 1) > 0.005 ? correction : 1,
        heldX: cx(facing) > box.x2 ? box.x2 : cx(facing) < box.x1 ? box.x1 : cx(box),
        heldY: cy(facing) > box.y2 ? box.y2 : cy(facing) < box.y1 ? box.y1 : cy(box) }
    })
    const targetWidth = dial.targets.widths[context]
    const before = inked.map((slot) => ({ path: slot.path, shape: slot.shape!, scale: geometry.scales[slot.role]!, group: slot.group, members: groups.get(slot.group)! }))
    const restore = () => inked.forEach((slot, index) => {
      const kept = before[index]
      slot.path = kept.path; slot.shape = kept.shape; geometry.scales[slot.role] = kept.scale
      if (slot.group !== kept.group) { groups.delete(slot.group); slot.group = kept.group; groups.set(kept.group, kept.members) }
    })
    const floor = minimumGap * 0.2
    /** The gap the layout keeps between two jamo, or the smallest one it accepts if they already sat closer than that. */
    const clear = (a: number, b: number) => hasInkClearance(inked[a].path, inked[b].path, inkClearance)
      || (!hasInkClearance(before[a].path, before[b].path, inkClearance) && hasInkClearance(inked[a].path, inked[b].path, floor))
    // Too close after the change, every correction is halved, and halved again; then the layout stays as it was.
    for (const share of [1, 0.5, 0.25, 0]) {
      restore()
      if (!share) break
      const sized = plans.map(({ box, correction, heldX, heldY }) => {
        const scale = 1 + (correction - 1) * share
        return { scale, box: { x1: heldX + (box.x1 - heldX) * scale, y1: heldY + (box.y1 - heldY) * scale, x2: heldX + (box.x2 - heldX) * scale, y2: heldY + (box.y2 - heldY) * scale } }
      })
      const body = union(sized.map((plan) => plan.box))
      // Whole percents: a jamo stretched by the same factor in another syllable is stretched once.
      const stretch = targetWidth ? Math.round((1 + (toward(dial.width, targetWidth / Math.max(1, body.x2 - body.x1), WIDTH_REACH) - 1) * share) * 100) / 100 : 1
      const changed = sized.map((plan) => plan.scale !== 1 || stretch !== 1)
      if (!changed.some(Boolean)) break
      if (dial.draft) {
        inked.forEach((slot, index) => {
          const { scale, box } = sized[index]; const from = lines[index]
          const x = cx(body) + (cx(box) - cx(body)) * stretch
          if (changed[index]) mapPoints(slot.path.commands, (px, py) => [x + (px - cx(from)) * scale * stretch, cy(box) + (py - cy(from)) * scale])
        })
        break
      }
      inked.forEach((slot, index) => {
        if (!changed[index]) return
        const { scale, box } = sized[index]
        if (scale !== 1 && before[index].members.length > 1 && slot.group === before[index].group) release(slot.group, before[index].members)
        // Centerlines are stretched about the middle of the syllable and outlined again, so the pen keeps its width.
        slot.shape = stretch === 1 ? before[index].shape : stretchedBy(before[index].shape, stretch)
        slot.path = new opentype.Path()
        geometry.scales[slot.role] = before[index].scale * scale
        appendCentered(slot.path, slot.shape, cx(body) + (cx(box) - cx(body)) * stretch, cy(box), geometry.scales[slot.role]!, input.penScale)
      })
      if (inked.every((_, a) => inked.every((_, b) => b <= a || (!changed[a] && !changed[b]) || clear(a, b)))) break
    }
  }

  const parts: Record<HangulRole, opentype.Path> = { initial: new opentype.Path(), medial: new opentype.Path(), final: new opentype.Path() }
  for (const slot of slots) {
    parts[slot.role] = slot.path; geometry.zones[slot.role] = asBox(slot.zone); geometry.groups[slot.role] = slot.group
    const b = bounds(slot.path); if (b) geometry.anchors[slot.role] = { x: cx(b), y: cy(b) }
  }
  if (final?.shape && !isPlaceholder('final')) geometry.finalShape = final.shape
  return { parts, geometry }
}
