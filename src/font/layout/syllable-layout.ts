import opentype from 'opentype.js'
import { COMPOUND_FINALS, decomposeHangul, HANGUL_ROLES, type HangulRole, type VowelKind } from '@/font/hangul'
import { clearanceProbe, hasInkClearance, maximizeSafeIntrusion } from '@/font/geometry/collision'
import { inkBalance } from '@/font/geometry/optical'
import { centerX as cx, centerY as cy, clamp, pathBounds as bounds, pathOf, pointsBox, splitContours, translatePath, unionBox as union, type Box } from '@/font/geometry/path-ops'
import { appendShape, CELL_UNITS, combineShapesSideBySide, stretchShapeWidth, type NormalizedShape, type Zone } from '@/font/geometry/shape'
import { DEFAULT_GAPS, finalGapContext, finalGapPair, gapContext, gapPair, minimumGap, type GapProfile } from './gap-profile'
import { allowsOverlap, finalBoxGap } from './overlap-policy'
import { EMPTY_PROPORTIONS, jamoSize, learnedRatios, proportionContext, proportionPair, type ProportionProfile } from './proportion-profile'
import { selectJamoSource, sourceKey } from './source-selection'

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
}

interface Slot {
  role: HangulRole
  shape?: NormalizedShape
  zone: Zone
  scale: number
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

const inkScale = (jamo: PlacedJamo) => jamo.shape ? CELL_UNITS * (jamo.scale ?? 0) : 0

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
export function medialSpace(path: opentype.Path): { horizontal: Box; vertical: Box } | undefined {
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
      const horizontal = union(left.filter((box) => box.x2 <= base.x2 + (body.x2 - body.x1) * 0.04))
      return { horizontal, vertical }
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
    const shape = selected?.source
    const group = selected?.match === 'exact' && shape && !shape.synthesized && shape.sourceCellId ? shape.sourceCellId : role
    return { role, shape, zone: zones[role], scale: input.scales?.[role] ?? 1, group, path: new opentype.Path() }
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
        const fit = Math.min(slot.zone.width / Math.max(1, shape.frame.width * CELL_UNITS), slot.zone.height / Math.max(1, shape.frame.height * CELL_UNITS))
        const scale = fit * slot.scale
        appendCentered(slot.path, shape, slot.zone.x + slot.zone.width / 2, slot.zone.y + slot.zone.height / 2, scale, input.penScale)
        geometry.scales[slot.role] = scale
      }
      if (isPlaceholder(slot.role)) {
        const box = bounds(slot.path); slot.path = new opentype.Path()
        rectangle(slot.path, box ? { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 } : { x: slot.zone.x + slot.zone.width * 0.2, y: slot.zone.y + slot.zone.height * 0.2, width: slot.zone.width * 0.6, height: slot.zone.height * 0.6 })
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
    if (!slot.shape || isPlaceholder(slot.role) || groups.get(slot.group)!.length > 1) return
    const box = bounds(slot.path)!
    const scale = geometry.scales[slot.role]! * correction
    slot.path = new opentype.Path()
    appendCentered(slot.path, slot.shape, cx(box), cy(box), scale, input.penScale)
    geometry.scales[slot.role] = scale
  }
  // Apply learned proportions to the already fitted sizes, not the source-cell extents.
  if (byRole.initial && !isPlaceholder('initial') && bounds(byRole.initial.path) && ratios) {
    const i = bounds(byRole.initial.path)!
    const size = (role: HangulRole, box: Box) => jamoSize(role, kind, box.x2 - box.x1 - minimumGap / 1.5 * 2, box.y2 - box.y1 - minimumGap / 1.5 * 2)
    for (const role of ['medial', 'final'] as const) {
      const slot = byRole[role]; const wanted = ratios[role]
      if (!slot?.shape || wanted === undefined || slot.group === byRole.initial.group || groups.get(slot.group)!.length > 1 || isPlaceholder(role)) continue
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
  const upperGap = upperPlacement?.advanceGap ?? gaps.contexts[gapContext(kind, hasFinal)] ?? gaps[kind]
  const finalPlacement = gaps.medialFinalSyllables[char] ?? gaps.medialFinalPairs[finalGapPair(chars.medial, chars.final)]
  const finalGap = finalPlacement?.advanceGap ?? gaps.finalContexts[finalGapContext(kind, chars.final)] ?? gaps.final
  if (initial && medial && initial.group !== medial.group) {
    const i = bounds(initial.path); const m = bounds(medial.path)
    if (i && m) {
      const space = kind === 'mixed' ? medialSpace(medial.path) : undefined
      const anchor = space ? { ...space.horizontal, x1: m.x1, x2: space.vertical.x1 } : m
      const cross = upperPlacement?.crossOffset ?? 0
      if (kind === 'vertical') move(initial, m.x1 - i.x2 - Math.max(minimumGap, upperGap), cy(m) - cy(i) - cross)
      else if (kind === 'mixed') {
        const headroom = clamp(((i.y2 - i.y1) / (i.x2 - i.x1) - 0.65) / 0.4, 0, 1)
        move(initial, anchor.x1 + (anchor.x2 - anchor.x1) * 0.35 - cx(i) - cross, m.y2 - i.y2 + (i.y2 - i.y1) * 0.45 * headroom)
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
      const directions = [[-1, 0], [0, 1], [0, -1], [-Math.SQRT1_2, Math.SQRT1_2]]
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
    if (kind === 'mixed') separate([medial], initial, 'corner', -1)
    else {
      // A pair the writer has sampled already carries its own overlap.
      const notch = !upperPlacement && allowsOverlap('initial-medial', chars.initial, chars.medial) ? 90 : 0
      // Interlocking ink keeps the same gap as jamo that merely sit side by side.
      separate([initial], medial, kind === 'vertical' ? 'x' : 'y', kind === 'vertical' ? 1 : -1, Math.max(0, minimumGap - upperGap) + notch, minimumGap)
    }
  }
  // A final built from parts has no written width: it stays within 90% of the
  // settled upper body, narrowing its wider part before shrinking as a whole.
  if (final?.shape?.synthesized && COMPOUND_FINALS[chars.final]) {
    const upper = upperSlots(); const f = bounds(final.path)
    if (upper.length && f) {
      const body = union(upper.map((slot) => bounds(slot.path)!))
      const limit = (body.x2 - body.x1) * 0.9
      const [left, right] = COMPOUND_FINALS[chars.final].map((part) => input.shapes.get(sourceKey('final', 0, part)))
      if (f.x2 - f.x1 > limit && left && right) {
        final.shape = { ...combineShapesSideBySide(left, right, limit / (f.y2 - f.y1)), sourceRole: 'final' }
        resize(final, 1)
      }
      // The pen does not shrink with the jamo, so one correction falls short.
      for (let pass = 0; pass < 3; pass += 1) {
        const fitted = bounds(final.path)!
        resize(final, Math.min(1, limit / (fitted.x2 - fitted.x1)))
      }
    }
  }
  // A written final wider than 90% of the settled upper body is narrowed, not
  // shrunk: it keeps its height, so it does not read as a smaller jamo.
  if (final?.shape && !final.shape.synthesized && groups.get(final.group)!.length === 1 && !isPlaceholder('final')) {
    const upper = upperSlots()
    if (upper.length && bounds(final.path)) {
      const body = union(upper.map((slot) => bounds(slot.path)!))
      // The pen does not narrow with the jamo, so one correction falls short.
      for (let pass = 0; pass < 3; pass += 1) {
        const fitted = bounds(final.path)!
        const factor = Math.min(1, (body.x2 - body.x1) * 0.9 / (fitted.x2 - fitted.x1))
        if (factor < 1) { final.shape = stretchShapeWidth(final.shape, factor); resize(final, 1) }
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

  const parts: Record<HangulRole, opentype.Path> = { initial: new opentype.Path(), medial: new opentype.Path(), final: new opentype.Path() }
  for (const slot of slots) {
    parts[slot.role] = slot.path; geometry.zones[slot.role] = asBox(slot.zone); geometry.groups[slot.role] = slot.group
    const b = bounds(slot.path); if (b) geometry.anchors[slot.role] = { x: cx(b), y: cy(b) }
  }
  if (final?.shape && !isPlaceholder('final')) geometry.finalShape = final.shape
  return { parts, geometry }
}
