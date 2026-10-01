import opentype from 'opentype.js'
import type { HangulRole } from '@/types/project'
import { appendShape, type NormalizedShape, type Zone, type Box } from './path-geometry'
import { selectJamoSource } from './source-selection'
import { decomposeHangul } from './hangul-structure'
import { DEFAULT_GAPS, gapContext, gapPair, finalGapContext, finalGapPair, minimumGap, type GapProfile } from './gap-profile'
import { learnedRatios, jamoSize, proportionContext, proportionPair, type ProportionProfile } from './proportion-profile'
import { maximizeSafeIntrusion, hasInkClearance } from './ink-collision'
import { overlapRule } from './overlap-policy'

const roles: HangulRole[] = ['initial', 'medial', 'final']
export interface LayoutGeometry {
  zones: Partial<Record<HangulRole, Box>>
  anchors: Partial<Record<HangulRole, { x: number; y: number }>>
  scales: Partial<Record<HangulRole, number>>
  groups: Partial<Record<HangulRole, string>>
}
export interface SyllableLayoutInput {
  codePoint: number; shapes: Map<string, NormalizedShape>; penScale: number
  omit?: ReadonlySet<HangulRole>; placeholder?: ReadonlySet<HangulRole>
  scales?: Partial<Record<HangulRole, number>>; gaps?: GapProfile; proportions?: ProportionProfile
}
interface Slot { role: HangulRole; shape?: NormalizedShape; zone: Zone; scale: number; group: string; path: opentype.Path }
const bounds = (path: opentype.Path): Box | undefined => path.commands.length ? path.getBoundingBox() : undefined
const cx = (b: Box) => (b.x1 + b.x2) / 2
const cy = (b: Box) => (b.y1 + b.y2) / 2
const union = (boxes: Box[]): Box => ({ x1: Math.min(...boxes.map(b => b.x1)), y1: Math.min(...boxes.map(b => b.y1)), x2: Math.max(...boxes.map(b => b.x2)), y2: Math.max(...boxes.map(b => b.y2)) })
const asBox = (z: Zone): Box => ({ x1: z.x, y1: z.y, x2: z.x + z.width, y2: z.y + z.height })
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
function contourBoxes(path: opentype.Path): Box[] {
  const contours: opentype.Path[] = []
  for (const command of path.commands) {
    if (command.type === 'M') contours.push(new opentype.Path())
    contours.at(-1)?.commands.push(command)
  }
  return contours.map(contour => contour.getBoundingBox())
}
/** Main vertical strokes carry alignment weight; horizontal arms do not. */
function verticalStem(path: opentype.Path) {
  const box = bounds(path)!
  const stems = contourBoxes(path).filter(b => b.y2 - b.y1 > (box.y2 - box.y1) * 0.65 && b.x2 - b.x1 < (b.y2 - b.y1) * 0.35)
  return stems.length ? union(stems) : box
}
function hasLargeLoop(shape: NormalizedShape | undefined) {
  const points = shape?.strokes?.flatMap(stroke => stroke.centerline?.points ?? []) ?? []
  if (points.length < 4) return false
  const xs = points.map(p => p[0]); const ys = points.map(p => p[1])
  const x1 = Math.min(...xs); const y1 = Math.min(...ys)
  const width = Math.max(...xs) - x1; const height = Math.max(...ys) - y1
  if (width <= 0 || height <= 0) return false
  const span = (list: typeof points, axis: 0 | 1) => list.length ? Math.max(...list.map(p => p[axis])) - Math.min(...list.map(p => p[axis])) : 0
  // An enclosing frame may be written in several strokes. Measure its four
  // sides together instead of requiring one artificially closed pen path.
  return span(points.filter(p => p[1] < y1 + height * 0.2), 0) > width * 0.7
    && span(points.filter(p => p[1] > y1 + height * 0.8), 0) > width * 0.7
    && span(points.filter(p => p[0] < x1 + width * 0.2), 1) > height * 0.7
    && span(points.filter(p => p[0] > x1 + width * 0.8), 1) > height * 0.7
}
export function translatePath(path: opentype.Path, dx: number, dy: number) {
  for (const command of path.commands) for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']] as const) {
    if (x in command && y in command) {
      const p = command as unknown as Record<string, number>
      p[x] += dx; p[y] += dy
    }
  }
}
/** Space budgets, not target aspect ratios. Empty space is allowed. */
function spaces(kind: ReturnType<typeof decomposeHangul>['kind'], final: boolean): Record<HangulRole, Zone> {
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
  const measured = contourBoxes(path).map(box => ({ box }))
  const stems = measured.filter(({ box }) => cx(box) > body.x1 + (body.x2 - body.x1) * 0.4
    && box.y2 - box.y1 > (body.y2 - body.y1) * 0.45 && box.x2 - box.x1 < (box.y2 - box.y1) * 0.5)
  if (stems.length) {
    const vertical = union(stems.map(s => s.box))
    const left = measured.filter(s => !stems.includes(s) && cx(s.box) < vertical.x1)
    const base = [...left].sort((a, b) => (b.box.x2 - b.box.x1) - (a.box.x2 - a.box.x1))[0]?.box
    if (base) {
      const horizontal = union(left.filter(s => s.box.x2 <= base.x2 + (body.x2 - body.x1) * 0.04).map(s => s.box))
      return { horizontal, vertical }
    }
  }
  const cutoff = body.x1 + (body.x2 - body.x1) * 0.62
  const points = path.commands.flatMap(c => 'x' in c ? [[c.x, c.y] as const] : [])
  const box = (list: ReadonlyArray<readonly [number, number]>): Box => ({ x1: Math.min(...list.map(p => p[0])), x2: Math.max(...list.map(p => p[0])), y1: Math.min(...list.map(p => p[1])), y2: Math.max(...list.map(p => p[1])) })
  const left = points.filter(([x]) => x <= cutoff); const right = points.filter(([x]) => x > cutoff)
  return left.length && right.length ? { horizontal: box(left), vertical: box(right) } : undefined
}
function rectangle(path: opentype.Path, z: Zone) {
  path.moveTo(z.x, z.y); path.lineTo(z.x + z.width, z.y); path.lineTo(z.x + z.width, z.y + z.height); path.lineTo(z.x, z.y + z.height); path.close()
}
export function layoutSyllable(input: SyllableLayoutInput) {
  const { kind, chars, variants, finalIndex } = decomposeHangul(input.codePoint)
  const zones = spaces(kind, finalIndex > 0)
  const gaps = input.gaps ?? DEFAULT_GAPS
  const char = String.fromCodePoint(input.codePoint)
  const ratios = learnedRatios(input.proportions, char, proportionPair(chars.initial, chars.medial, chars.final || undefined), proportionContext(kind, finalIndex > 0))
  const slots = roles.filter(role => (role !== 'final' || finalIndex) && !input.omit?.has(role)).map((role): Slot => {
    // Unwritten roles reserve neutral space. Donor ink must not determine the
    // placeholder size or become a size reference for a visible guide jamo.
    const selected = input.placeholder?.has(role) ? undefined : selectJamoSource(input.shapes, role, variants[role], chars[role]); const shape = selected?.source
    const group = selected?.match === 'exact' && shape?.frame && !shape.synthesized && shape.sourceCellId && !input.placeholder?.has(role) ? shape.sourceCellId : role
    return { role, shape, zone: zones[role], scale: input.scales?.[role] ?? 1, group, path: new opentype.Path() }
  })
  const byRole = Object.fromEntries(slots.map(slot => [slot.role, slot])) as Partial<Record<HangulRole, Slot>>
  const groups = new Map<string, Slot[]>()
  for (const slot of slots) groups.set(slot.group, [...(groups.get(slot.group) ?? []), slot])
  const geometry: LayoutGeometry = { zones: {}, anchors: {}, scales: {}, groups: {} }
  for (const members of groups.values()) {
    const framed = members.length > 1 && members.every(slot => slot.shape?.frame)
    const target = union(members.map(slot => asBox(slot.zone)))
    const native = framed ? union(members.map(slot => {
      const f = slot.shape!.frame!
      return { x1: f.x * 1000, y1: (1 - f.y - f.height) * 1000, x2: (f.x + f.width) * 1000, y2: (1 - f.y) * 1000 }
    })) : undefined
    const common = native ? Math.min((target.x2 - target.x1) / Math.max(1, native.x2 - native.x1), (target.y2 - target.y1) / Math.max(1, native.y2 - native.y1)) : 1
    for (const slot of members) {
      const shape = slot.shape
      if (framed && native) {
        const scale = common * Math.min(...members.map(m => m.scale))
        appendShape(slot.path, shape!, { x: cx(target) - cx(native) * scale, y: cy(target) - cy(native) * scale, width: 1000 * scale, height: 1000 * scale }, true, input.penScale)
        geometry.scales[slot.role] = scale
      } else if (shape) {
        const factor = slot.scale
        const fit = Math.min(slot.zone.width / Math.max(1, (shape.frame?.width ?? shape.aspectRatio * 0.4) * 1000), slot.zone.height / Math.max(1, (shape.frame?.height ?? 0.4) * 1000))
        const scale = fit * factor
        if (shape.frame) {
          const f = shape.frame
          appendShape(slot.path, shape, { x: slot.zone.x + slot.zone.width / 2 - (f.x + f.width / 2) * 1000 * scale, y: slot.zone.y + slot.zone.height / 2 - (1 - f.y - f.height / 2) * 1000 * scale, width: 1000 * scale, height: 1000 * scale }, true, input.penScale)
        } else {
          const width = Math.min(slot.zone.width, slot.zone.height * shape.aspectRatio) * factor; const height = width / shape.aspectRatio
          appendShape(slot.path, shape, { x: slot.zone.x + (slot.zone.width - width) / 2, y: slot.zone.y + (slot.zone.height - height) / 2, width, height }, false, input.penScale)
        }
        geometry.scales[slot.role] = scale
      }
      if (input.placeholder?.has(slot.role)) {
        const box = bounds(slot.path); slot.path = new opentype.Path()
        rectangle(slot.path, box ? { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 } : { x: slot.zone.x + slot.zone.width * 0.2, y: slot.zone.y + slot.zone.height * 0.2, width: slot.zone.width * 0.6, height: slot.zone.height * 0.6 })
      }
    }
  }
  // A captured arrangement is a preference, not permission to retain crossing
  // ink. Release only unsafe groups; their jamo keep their similarity transforms.
  for (const [id, members] of [...groups]) {
    const unsafe = members.some((a, index) => members.slice(index + 1).some(b => !hasInkClearance(a.path, b.path, minimumGap / 3)))
    if (!unsafe) continue
    groups.delete(id)
    for (const slot of members) { slot.group = slot.role; groups.set(slot.group, [slot]) }
  }
  const resize = (slot: Slot, correction: number) => {
    if (!slot.shape || input.placeholder?.has(slot.role) || groups.get(slot.group)!.length > 1) return
    const box = bounds(slot.path)!
    const shape = slot.shape; const scale = geometry.scales[slot.role]! * correction
    slot.path = new opentype.Path()
    if (shape.frame) {
      const f = shape.frame
      appendShape(slot.path, shape, { x: cx(box) - (f.x + f.width / 2) * 1000 * scale, y: cy(box) - (1 - f.y - f.height / 2) * 1000 * scale, width: 1000 * scale, height: 1000 * scale }, true, input.penScale)
    } else {
      const width = (box.x2 - box.x1) * correction; const height = width / shape.aspectRatio
      appendShape(slot.path, shape, { x: cx(box) - width / 2, y: cy(box) - height / 2, width, height }, false, input.penScale)
    }
    geometry.scales[slot.role] = scale
  }
  // Apply learned proportions to the already fitted sizes, not the source-cell
  // extents. Rebuild the centerlines so the pen does not scale with the jamo.
  if (byRole.initial && !input.placeholder?.has('initial') && bounds(byRole.initial.path) && ratios) {
    const i = bounds(byRole.initial.path)!
    const size = (role: HangulRole, box: Box) => jamoSize(role, kind, box.x2 - box.x1 - minimumGap / 1.5 * 2, box.y2 - box.y1 - minimumGap / 1.5 * 2)
    for (const role of ['medial', 'final'] as const) {
      const slot = byRole[role]; const wanted = ratios[role]
      if (!slot?.shape || wanted === undefined || slot.group === byRole.initial.group || groups.get(slot.group)!.length > 1 || input.placeholder?.has(role)) continue
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
  if (finalIndex && initial && medial && final && bounds(medial.path) && bounds(final.path) && initial.shape?.sourceCellId) {
    const members = groups.get(final.group)!
    if (members.length === 2 && !members.includes(initial)) {
      groups.delete(final.group)
      for (const member of members) { member.group = member.role; groups.set(member.group, [member]) }
    }
    const i = bounds(initial.path)
    if (i && kind === 'vertical') {
      resize(initial, 0.83)
      resize(final, 0.82)
      // Parallel vowel stems need less width in a closed syllable, while a
      // single stem keeps its original height and aspect ratio.
      const stems = contourBoxes(medial.path).filter(b => b.y2 - b.y1 > (bounds(medial.path)!.y2 - bounds(medial.path)!.y1) * 0.7)
      if (stems.length > 1) resize(medial, 0.84)
    } else if (i && kind === 'mixed' && hasLargeLoop(final.shape)) {
      resize(final, 0.7)
    } else if (i && kind !== 'mixed') {
      const aspect = (i.x2 - i.x1) / (i.y2 - i.y1)
      resize(initial, kind === 'horizontalUp' ? clamp(1.45 - 0.34 * aspect, 0.89, 1.16) : 0.92)
      resize(final, kind === 'horizontalDown' ? clamp((bounds(final.path)!.y2 - bounds(final.path)!.y1) / (bounds(final.path)!.x2 - bounds(final.path)!.x1) * 1.4, 1, 1.43) : 0.94)
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
  if (final) {
    const upper = [initial, medial].filter((s): s is Slot => Boolean(s && bounds(s.path)))
    const f = bounds(final.path)
    if (upper.length && f) {
      const body = union(upper.map(s => bounds(s.path)!))
      resize(final, Math.min(1, (body.x2 - body.x1) * 0.85 / (f.x2 - f.x1)))
    }
  }
  const pair = gapPair(chars.initial, chars.medial, finalIndex > 0)
  const upperPlacement = gaps.initialMedialSyllables?.[char] ?? gaps.initialMedialPairs?.[pair]
  const upperGap = upperPlacement?.advanceGap ?? gaps.syllables?.[char] ?? gaps.pairs?.[pair] ?? gaps.contexts?.[gapContext(kind, finalIndex > 0)] ?? gaps[kind] ?? minimumGap
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
  if (final) {
    const f = bounds(final.path); const upper = [initial, medial].filter((slot): slot is Slot => Boolean(slot && bounds(slot.path)))
    if (f && upper.length) {
      const body = union(upper.map(slot => bounds(slot.path)!))
      const anchor = kind === 'mixed' && medial ? medialSpace(medial.path)?.horizontal ?? body : body
      const fp = finalGapPair(chars.medial, chars.final)
      const placement = gaps.medialFinalSyllables?.[char] ?? gaps.medialFinalPairs?.[fp]
      const gap = placement?.advanceGap ?? gaps.finalSyllables?.[char] ?? gaps.finalPairs?.[fp] ?? gaps.finalContexts?.[finalGapContext(kind, chars.final)] ?? gaps.final ?? minimumGap
      // A narrow final balances the consonant and the vowel's main stem;
      // wide compound finals use the full upper body. Arms are empty-space
      // boundaries, not extra weight pulling the final to the right.
      const m = medial && bounds(medial.path)
      const i = initial && bounds(initial.path)
      const stemX = medial && m ? cx(verticalStem(medial.path)) : cx(body)
      const balance = kind === 'vertical' && i && m && initial?.group !== medial?.group ? cx(i) * 0.65 + stemX * 0.35 : cx(body)
      const spread = Math.max(0, Math.min(1, (f.x2 - f.x1) / (f.y2 - f.y1) - 1))
      const finalCenter = kind === 'mixed' && m ? cx(m) : balance * (1 - spread) + cx(body) * spread
      const spaceGap = Math.min(Math.max(minimumGap, gap), (m ? m.y2 - m.y1 : body.y2 - body.y1) * 0.1)
      if (!upper.some(slot => slot.group === final.group)) move(final, finalCenter - cx(f) + (placement?.crossOffset ?? 0), anchor.y1 - f.y2 - spaceGap)
      else if (initial && medial && initial.group !== final.group && medial.group === final.group && kind === 'vertical') {
        const i = bounds(initial.path)
        // A slot can exist before its source jamo has been written.
        if (i) move(initial, 2 * cx(f) - body.x2 - i.x1, 0)
      }
    }
  }
  const clearance = minimumGap * (kind === 'mixed' ? 0.2 : 0.8)
  const separate = (fixed: Slot[], moving: Slot, axis: 'x' | 'y' | 'corner', direction: -1 | 1, maximum = 0) => {
    const stationary = fixed.filter(slot => slot.group !== moving.group && slot.path.commands.length)
    if (!stationary.length || !moving.path.commands.length) return
    const path = new opentype.Path(); path.commands.push(...stationary.flatMap(slot => slot.path.commands))
    const movingPath = new opentype.Path()
    movingPath.commands.push(...groups.get(moving.group)!.flatMap(slot => slot.path.commands))
    // Search around the preferred corner instead of forcing every conflict
    // along one diagonal, which used to eject the initial above the syllable.
    if (axis === 'corner' && !hasInkClearance(path, movingPath, clearance)) {
      const directions = [[-1, 0], [0, 1], [0, -1], [-Math.SQRT1_2, Math.SQRT1_2]]
      for (let radius = clearance; radius <= 1200; radius += clearance) {
        for (const [x, y] of directions) {
          translatePath(movingPath, radius * x, radius * y)
          const safe = hasInkClearance(path, movingPath, clearance)
          translatePath(movingPath, -radius * x, -radius * y)
          if (safe) { move(moving, radius * x, radius * y); return }
        }
      }
    }
    let distance = 0
    while (!hasInkClearance(path, movingPath, clearance) && distance < 1200) {
      move(moving, axis !== 'y' ? direction * clearance : 0, axis === 'corner' ? -direction * clearance : axis === 'y' ? direction * clearance : 0); distance += clearance
    }
    if (maximum > 0 && axis !== 'corner') {
      const intrusion = maximizeSafeIntrusion(path, movingPath, { axis, direction: -direction as -1 | 1, clearance, maximum, step: clearance })
      move(moving, axis === 'x' ? -direction * intrusion : 0, axis === 'y' ? -direction * intrusion : 0)
    }
  }
  if (initial && medial && initial.group !== medial.group) {
    const rule = overlapRule('initial-medial', chars.initial, chars.medial)
    const specific = upperPlacement || gaps.syllables?.[char] !== undefined || gaps.pairs?.[pair] !== undefined
    if (kind === 'mixed') separate([medial], initial, 'corner', -1)
    else separate([initial], medial, kind === 'vertical' ? 'x' : 'y', kind === 'vertical' ? 1 : -1, Math.max(0, minimumGap - upperGap) + (!specific && rule ? 90 : 0))
  }
  if (final) {
    const fp = finalGapPair(chars.medial, chars.final)
    const gap = gaps.finalSyllables?.[char] ?? gaps.finalPairs?.[fp] ?? gaps.finalContexts?.[finalGapContext(kind, chars.final)] ?? gaps.final ?? minimumGap
    const rule = overlapRule('medial-final', chars.medial, chars.final)
    separate([initial, medial].filter((s): s is Slot => Boolean(s)), final, 'y', -1, Math.max(0, minimumGap - gap) + (rule ? 90 : 0))
  }
  const parts: Record<HangulRole, opentype.Path> = { initial: new opentype.Path(), medial: new opentype.Path(), final: new opentype.Path() }
  for (const slot of slots) {
    parts[slot.role] = slot.path; geometry.zones[slot.role] = asBox(slot.zone); geometry.groups[slot.role] = slot.group
    const b = bounds(slot.path); if (b) geometry.anchors[slot.role] = { x: cx(b), y: cy(b) }
  }
  return { parts, geometry }
}
