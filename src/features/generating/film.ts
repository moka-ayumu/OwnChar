import { WRITING_EXERCISES, type WritingExercise } from '@/collection/exercises'
import { ROLE_LABELS } from '@/collection/prompts'
import { cellOrigin, type WritingSessionRecord } from '@/collection/records'
import { prepareCffPath } from '@/font/geometry/cff'
import { svgPathData } from '@/font/geometry/svg'
import type opentype from 'opentype.js'
import { inkBalance } from '@/font/geometry/optical'
import { CELL_UNITS } from '@/font/geometry/shape'
import { finalAnchorX, finalTargetX, medialSpace, STEM_SHARE, verticalStem } from '@/font/layout/syllable-layout'
import type { Box, Point } from '@/font/geometry/path-ops'
import { visualCalibrationScale } from '@/font/glyphs/calibration'
import { decomposeHangul, HANGUL_BASE, HANGUL_COUNT, INITIALS, isHangulSyllable, syllableRoles, type HangulRole, type VowelKind } from '@/font/hangul'
import { selectJamoSource, sourceKey } from '@/font/layout/source-selection'
import { penDiameter, strokeSvgPath, type RawStroke } from '@/font/stroke/outline'
import { stabilizeStroke } from '@/font/stroke/stabilizer'
import { composedHangulParts, hangulComposeOptions, mergedOverride, type HangulCompositionInputs } from '@/generation/font-builder'
import { learnCompositionProfile, shapesFromRequestDrawings, toRequestDrawings } from '@/generation/inputs'
import { completedHangulCells } from '@/generation/learning/samples'
import { LEAD_SENTENCE, type StageOrigin } from '@/lib/flow'
import type { ProjectState } from '@/project/types'

/** The stages of generation, in the order the film shows them. */
export const FILM_STEPS = ['원본 필기', '간격·비율 학습', '손떨림 보정', '윤곽선 만들기', '자모 분리', '크기 정규화', '문맥형 선택', '문맥별 조합', '받침 가운데 맞춤', '윤곽 병합', '11,172자 조합', 'OTF 묶기'] as const
export const LANES_STEP = 10
export const BIND_STEP = 11
/** Past the last step: the sentence is leaving for the preview. */
export const DONE_STEP = 12
/** Seconds the worker blocks take to join into one strip. */
export const BIND_LENGTH = 0.6

const INK = '#101114'
const INK_2 = '#4a4c52'
const LIME = '#C6F432'
const RULE = '#D9DAD5'
const FONT = '"Wanted Sans Variable", "Wanted Sans", sans-serif'
/** Share of the specimen box a 1000-unit em takes. */
const EM_FIT = 0.84
/** The steps whose result is kept in the trail: every step shown on the specimens. */
const TRAIL = LANES_STEP
/** Seconds a finished result takes to dock in the trail. */
const DOCK = 0.4
const LANE_HEIGHT = 12
const LANE_PITCH = 22
/** Seconds between the glyphs of the sentence leaving the strip, and how long each travels. */
const LIFT_STAGGER = 0.025
const LIFT_TRAVEL = 0.45

/** Start of each step in seconds; the last entry is when the lanes have had their minimum time. */
const CUES = [0, 1.4, 3.1, 4.6, 5.3, 6.1, 7.2, 8.7, 9.9, 12.3, 13.0, 13.7]

interface PlacedPath { path: Path2D; x: number; y: number; cellIndex: number }
interface SpecimenStroke { role: HangulRole | undefined; raw: Point[]; steady: Point[]; outline: Path2D; x: number; y: number; diameter: number }
interface RoleInk { role: HangulRole; char: string; box: Box }
interface ComposedRole { role: HangulRole; path: Path2D; box: Box; zone?: Box }
interface Composed { char: string; note: string; roles: ComposedRole[] }
/** Which of a jamo's context forms were written; the rest are borrowed from the nearest one. */
interface RoleForms { role: HangulRole; written: boolean[] }
/** How a final is centred under the upper pair, in font units: between the left of the body and the right of the vowel's stem, by the middle of the bulk of its ink. */
interface Optical { glyph: Composed; body: Box; stem?: Box; target: number; anchor: number; core: [number, number]; final: Box }
interface Specimen {
  char: string
  kind: VowelKind
  cellIndex: number
  cellSize: number
  strokes: SpecimenStroke[]
  roles: RoleInk[]
  /** The syllable itself, then syllables that reuse its jamo. */
  composed: Composed[]
  /** The syllable's outline once its overlapping contours are merged. */
  merged: Path2D
  /** Where hand-shake correction moves the pen path most, in cell pixels; undefined when it barely moves it. */
  focus?: Point
  optical?: Optical
  forms: RoleForms[]
}
/** A syllable of the preview sentence: where it sits among the 11,172 and how the font shifts it. */
interface LineGlyph { index: number; syllable: number; glyph: Composed; dx: number; dy: number }
/** Where a character of the preview sentence stands on the stage. */
export interface LineTarget { x: number; baseline: number }

export interface FilmData {
  sentence?: { paths: PlacedPath[]; width: number; height: number; cellSize: number; columns: number }
  /** Up to three syllables written whole, of different layouts. */
  specimens: Specimen[]
  /** What the whole of the handwriting taught: how many syllables were measured, and the height and centre they share, in font units. */
  learned: { count: number; height: number; center: number }
  /** Share of all jamo placements that use a form written in that very context. */
  exactShare: number
  line: LineGlyph[]
  /** A syllable as the font will hold it, or undefined when its jamo were not written. */
  compose(codePoint: number): Composed | undefined
  origin: StageOrigin | null
}

const ease = (value: number) => 1 - (1 - Math.max(0, Math.min(1, value))) ** 4
const span = (value: number, from: number, to: number) => Math.max(0, Math.min(1, (value - from) / (to - from)))
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount

function pointsBox(points: readonly Point[], pad: number): Box {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return { x1: Math.min(...xs) - pad, y1: Math.min(...ys) - pad, x2: Math.max(...xs) + pad, y2: Math.max(...ys) + pad }
}

function union(boxes: Box[]): Box {
  return { x1: Math.min(...boxes.map((box) => box.x1)), y1: Math.min(...boxes.map((box) => box.y1)), x2: Math.max(...boxes.map((box) => box.x2)), y2: Math.max(...boxes.map((box) => box.y2)) }
}

/** The layout family a syllable belongs to; the specimens are taken from different ones. */
function family(codePoint: number) {
  const { kind, finalIndex } = decomposeHangul(codePoint)
  return finalIndex ? 'final' : kind === 'vertical' ? 'beside' : kind === 'mixed' ? 'mixed' : 'below'
}

/** Reads the project into what the film draws: the sentence, the specimen syllables, and a composer for any syllable. */
export function buildFilm(state: ProjectState, origin: StageOrigin | null): FilmData {
  const settings = state.compositionSettings
  const strength = settings.endpointStabilization
  const shapes = shapesFromRequestDrawings(toRequestDrawings(state.drawings, state.writingSessions), settings)
  const profile = learnCompositionProfile(state.writingSessions, settings)
  const composition: HangulCompositionInputs = { ...profile, compositionSettings: settings }
  const visualScale = visualCalibrationScale(shapes, settings, hangulComposeOptions(profile))

  const cache = new Map<number, Composed | undefined>()
  const compose = (codePoint: number): Composed | undefined => {
    if (!cache.has(codePoint)) cache.set(codePoint, composeFresh(codePoint))
    return cache.get(codePoint)
  }
  const composeFresh = (codePoint: number): Composed | undefined => {
    const { path, parts, geometry } = composedHangulParts(codePoint, shapes, composition, visualScale)
    if (!path.commands.length) return undefined
    const { variants, finalIndex } = decomposeHangul(codePoint)
    const roles = syllableRoles(codePoint).flatMap((role): ComposedRole[] => {
      const part = parts[role]
      if (!part?.commands.length) return []
      const box = part.getBoundingBox()
      return [{ role, path: new Path2D(svgPathData(part.commands)), box: { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 }, zone: geometry.zones[role] }]
    })
    if (roles.length < syllableRoles(codePoint).length) return undefined
    return { char: String.fromCodePoint(codePoint), note: `초 ${variants.initial + 1}벌 · 중 ${variants.medial + 1}벌${finalIndex ? ` · 종 ${variants.final + 1}벌` : ''}`, roles }
  }

  // The same choice the composer makes for every jamo of every syllable.
  let exact = 0
  let placements = 0
  for (let index = 0; index < HANGUL_COUNT; index += 1) {
    const { chars, variants, finalIndex } = decomposeHangul(HANGUL_BASE + index)
    for (const role of ['initial', 'medial', 'final'] as const) {
      if (role === 'final' && !finalIndex) continue
      placements += 1
      const selected = selectJamoSource(shapes, role, variants[role], chars[role])
      if (selected?.match === 'exact' && !selected.source.synthesized) exact += 1
    }
  }

  const line = [...LEAD_SENTENCE].flatMap((char, index): LineGlyph[] => {
    const codePoint = char.codePointAt(0)!
    const glyph = isHangulSyllable(codePoint) ? compose(codePoint) : undefined
    if (!glyph) return []
    const override = mergedOverride({ overrides: state.glyphOverrides, globalMetrics: state.globalMetrics }, codePoint)
    const ink = union(glyph.roles.map((role) => role.box))
    return [{ index, syllable: codePoint - HANGUL_BASE, glyph, dx: settings.widthMode === 'proportional' ? 55 + override.left - ink.x1 : override.left, dy: override.y }]
  })

  const film: FilmData = {
    specimens: [], compose, origin: null, line,
    learned: { count: completedHangulCells(state.writingSessions).length, height: profile.hangulTargetHeight, center: profile.hangulTargetCenter },
    exactShare: placements ? exact / placements : 0,
  }

  /** A cell of a sentence as a specimen, or undefined unless every jamo of it was written there and composes. */
  const specimenOf = (exercise: WritingExercise, session: WritingSessionRecord, cellIndex: number): Specimen | undefined => {
    const cell = exercise.cells[cellIndex]
    const codePoint = cell.char.codePointAt(0)!
    if (!isHangulSyllable(codePoint)) return undefined
    const own = compose(codePoint)
    if (!own) return undefined
    const { cellSize, columns } = session
    const cellOf = new Map(session.assignments.map((item) => [item.elementId, item]))
    const corner = cellOrigin(cellIndex, columns, cellSize)
    const strokes = session.elements.filter((stroke) => !stroke.isDeleted && stroke.points.length && cellOf.get(stroke.id)?.cellIndex === cellIndex).map((stroke: RawStroke): SpecimenStroke => {
      const diameter = penDiameter(stroke.strokeWidth, cellSize)
      const steady = stabilizeStroke(stroke.points, stroke.pressures, diameter, 'complete', strength).points
      const place = (points: readonly Point[]) => points.map(([x, y]) => [stroke.x + x - corner.x, stroke.y + y - corner.y] as Point)
      return {
        role: cell.slots[cellOf.get(stroke.id)!.slotIndex]?.role,
        raw: place(stroke.points), steady: place(steady.length === stroke.points.length ? steady : stroke.points),
        outline: new Path2D(strokeSvgPath(stroke, cellSize, strength)), x: stroke.x - corner.x, y: stroke.y - corner.y, diameter,
      }
    })
    const roles = cell.slots.flatMap((slot): RoleInk[] => {
      const ink = strokes.filter((stroke) => stroke.role === slot.role)
      if (!slot.role || !ink.length) return []
      return [{ role: slot.role, char: slot.char, box: union(ink.map((stroke) => pointsBox(stroke.steady, stroke.diameter / 2))) }]
    })
    if (roles.length < cell.slots.length) return undefined
    const { initialIndex, vowelIndex, finalIndex, kind } = decomposeHangul(codePoint)
    const siblings = [
      ...[0, 8, 13, 20, 9, 4].filter((vowel) => vowel !== vowelIndex).map((vowel) => [initialIndex, vowel, finalIndex]),
      ...[0, 2, 11, 18].filter((initial) => initial !== initialIndex).map((initial) => [initial, vowelIndex, finalIndex]),
    ].map(([initial, vowel, final]) => compose(HANGUL_BASE + initial * 588 + vowel * 28 + final)).filter((item) => item !== undefined)
    const forms = roles.map((item): RoleForms => ({
      role: item.role,
      written: Array.from({ length: item.role === 'initial' ? 8 : item.role === 'medial' ? 2 : 1 }, (_, form) => {
        const shape = shapes.get(sourceKey(item.role, form, item.char))
        return Boolean(shape && !shape.synthesized)
      }),
    }))
    let focus: Point | undefined
    let moved = cellSize * 0.01
    for (const stroke of strokes) stroke.raw.forEach(([x, y], index) => {
      const distance = Math.hypot(x - stroke.steady[index][0], y - stroke.steady[index][1])
      if (distance > moved) { moved = distance; focus = [x, y] }
    })
    // A syllable with the same upper jamo and a final that was not written with them: there the final is placed by rule.
    let optical: Optical | undefined
    for (const final of [16, 17, 4, 1, 8, 21]) {
      const target = HANGUL_BASE + initialIndex * 588 + vowelIndex * 28 + final
      const glyph = target === codePoint ? undefined : compose(target)
      if (!glyph) continue
      const { parts, geometry } = composedHangulParts(target, shapes, composition, visualScale)
      if (geometry.groups.final === geometry.groups.initial || geometry.groups.final === geometry.groups.medial) continue
      const box = (path: opentype.Path): Box => { const b = path.getBoundingBox(); return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } }
      const body = union([box(parts.initial), box(parts.medial)])
      const stem = kind === 'vertical' ? verticalStem(parts.medial) : kind === 'mixed' ? medialSpace(parts.medial)?.vertical : undefined
      const placed = { path: parts.final, shape: geometry.finalShape, scale: geometry.scales.final }
      const anchor = finalAnchorX(placed)
      const own = box(parts.final)
      const half = Math.min(own.x2 - own.x1, placed.shape && placed.scale ? inkBalance(placed.shape).span * CELL_UNITS * placed.scale : Infinity) / 2
      optical = { glyph, body, stem, target: finalTargetX(kind, { path: parts.initial }, { path: parts.medial }), anchor, core: [anchor - half, anchor + half], final: own }
      break
    }
    const whole = composedHangulParts(codePoint, shapes, composition, visualScale).path
    return { char: cell.char, kind, cellIndex, cellSize, strokes, roles, composed: [own, ...siblings.slice(0, 3)], merged: new Path2D(svgPathData(prepareCffPath(whole).commands)), forms, focus, optical }
  }

  // The specimens come from one sentence, the one the writer just left when it has whole syllables.
  const order = [origin?.exerciseId, WRITING_EXERCISES[state.currentExercise]?.id, ...WRITING_EXERCISES.map((item) => item.id)]
  let best: { exercise: WritingExercise; session: WritingSessionRecord; specimens: Specimen[] } | undefined
  for (const exerciseId of new Set(order)) {
    const session = exerciseId ? state.writingSessions[exerciseId] : undefined
    const exercise = WRITING_EXERCISES.find((item) => item.id === exerciseId)
    if (!session || !exercise) continue
    const written = new Set(session.assignments.map((item) => item.cellIndex))
    const whole = [...written].sort((a, b) => a - b).flatMap((cellIndex) => specimenOf(exercise, session, cellIndex) ?? [])
    // One of each layout family first, then whatever else was written whole.
    const chosen: Specimen[] = []
    for (const name of ['beside', 'below', 'final', 'mixed']) {
      const found = whole.find((item) => family(item.char.codePointAt(0)!) === name)
      if (found && chosen.length < 3) chosen.push(found)
    }
    for (const item of whole) if (chosen.length < 3 && !chosen.some((other) => other.char === item.char)) chosen.push(item)
    if (chosen.length > (best?.specimens.length ?? 0)) best = { exercise, session, specimens: chosen.sort((a, b) => a.cellIndex - b.cellIndex) }
    if (chosen.length === 3) break
  }

  const sentenceId = best?.exercise.id ?? origin?.exerciseId
  const session = sentenceId ? state.writingSessions[sentenceId] : undefined
  const exercise = WRITING_EXERCISES.find((item) => item.id === sentenceId)
  if (!session || !exercise) return film
  const cellOf = new Map(session.assignments.map((item) => [item.elementId, item]))
  const { cellSize, columns } = session
  film.sentence = {
    paths: session.elements.filter((stroke) => !stroke.isDeleted && stroke.points.length).map((stroke): PlacedPath => ({ path: new Path2D(strokeSvgPath(stroke, cellSize, strength)), x: stroke.x, y: stroke.y, cellIndex: cellOf.get(stroke.id)?.cellIndex ?? -1 })),
    width: columns * cellSize, height: Math.ceil(exercise.cells.length / columns) * cellSize, cellSize, columns,
  }
  film.origin = origin?.exerciseId === sentenceId ? origin : null
  film.specimens = best?.specimens ?? []
  return film
}

export interface FilmFrame {
  /** Seconds since the film started. */
  time: number
  /** Share of the 11,172 syllables composed so far, 0 to 1. */
  composed: number
  /** Share of its own range each worker has composed; one entry when the syllables are composed in one place. */
  lanes: number[]
  /** 'none' draws only the lanes, for reduced motion. */
  kind: 'full' | 'none'
  /** Seconds since the font was finished and the film played through, or -1. */
  bind: number
  /** Seconds since the preview sentence began to leave the strip, or -1. */
  lift: number
  /** Where each character of the preview sentence stands, once measured. */
  targets: LineTarget[] | null
  /** Size of the preview sentence in pixels. */
  em: number
}

/** The step the film is on at `time`. */
export function filmStep(data: FilmData, kind: FilmFrame['kind'], time: number) {
  if (kind === 'none' || !data.specimens.length) return LANES_STEP
  let step = 0
  for (let index = step + 1; index <= LANES_STEP; index += 1) if (time >= CUES[index]) step = index
  return step
}

/** When the film reaches the lanes: until then it shows the specimens, and may be slowed to keep pace with the work. */
export function lanesCue(data: FilmData, kind: FilmFrame['kind']) {
  if (kind === 'none' || !data.specimens.length) return 0
  return CUES[LANES_STEP]
}

/** How long the film runs before the blocks may be joined. */
export function filmLength(data: FilmData, kind: FilmFrame['kind']) {
  if (kind === 'none') return 0
  if (!data.specimens.length) return 2.4
  return CUES[BIND_STEP]
}

/** How long the preview sentence takes to leave the strip and settle. */
export function liftLength(data: FilmData) {
  return LIFT_TRAVEL + data.line.length * LIFT_STAGGER + 0.08
}

/** Where a jamo's ink goes: cell pixels scaled by (kx, ky), then moved by (tx, ty). */
interface Pose { kx: number; ky: number; tx: number; ty: number }
const lerpPose = (from: Pose, to: Pose, amount: number): Pose => ({ kx: mix(from.kx, to.kx, amount), ky: mix(from.ky, to.ky, amount), tx: mix(from.tx, to.tx, amount), ty: mix(from.ty, to.ty, amount) })
/** A square on the stage. */
interface Square { left: number; top: number; side: number }
const lerpSquare = (from: Square, to: Square, amount: number): Square => ({ left: mix(from.left, to.left, amount), top: mix(from.top, to.top, amount), side: mix(from.side, to.side, amount) })

/** Draws one frame of the generation film on a canvas of `width` by `height` CSS pixels. */
export function drawFilm(context: CanvasRenderingContext2D, width: number, height: number, dpr: number, data: FilmData, frame: FilmFrame) {
  const base = () => context.setTransform(dpr, 0, 0, dpr, 0, 0)
  base()
  context.clearRect(0, 0, width, height)
  const specimens = data.specimens
  const step = frame.bind >= 0 ? BIND_STEP : filmStep(data, frame.kind, frame.time)
  const cues = CUES
  const local = (index: number) => span(frame.time, cues[index], cues[index + 1])

  // The specimens stand in a row of equal boxes.
  const gap = 32
  const count = Math.max(1, specimens.length)
  const side = Math.floor(Math.min(height * 0.46, (width - 96 - (count - 1) * gap) / count, 340))
  const rowLeft = (width - count * side - (count - 1) * gap) / 2
  const rowTop = Math.round(height * 0.43 - side / 2)
  const box = (index: number): Square => ({ left: Math.round(rowLeft + index * (side + gap)), top: rowTop, side })

  // Everything drawn while `veil` is below 1 fades with it.
  let veil = 1
  const alpha = (value: number) => { context.globalAlpha = Math.max(0, Math.min(1, value)) * veil }
  const label = (text: string, x: number, y: number, weight = 600, size = 14, align: CanvasTextAlign = 'left', color = INK) => {
    context.font = `${weight} ${size}px ${FONT}`
    context.textAlign = align
    context.textBaseline = 'alphabetic'
    context.fillStyle = color
    context.fillText(text, x, y)
  }
  const hairline = (x: number, y: number, w: number, h: number, color = INK, dash: number[] = []) => {
    context.setLineDash(dash)
    context.lineWidth = 1
    context.strokeStyle = color
    context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h))
    context.setLineDash([])
  }

  /** One specimen at step `at`, `u` of the way through it, inside `square`. `mini` is the finished result as the trail keeps it. */
  const drawSpecimen = (specimen: Specimen, square: Square, at: number, u: number, mini: boolean) => {
    const { left, top, side: size } = square
    const { cellSize, strokes, roles, composed } = specimen
    // Font units to stage pixels: the 1000-unit em sits inside the box with a margin.
    const fk = size * EM_FIT / 1000
    const fx = (x: number) => left + size * (1 - EM_FIT) / 2 + x * fk
    const fy = (y: number) => top + size * (1 - EM_FIT) / 2 + (900 - y) * fk
    const cellPose: Pose = { kx: size / cellSize, ky: size / cellSize, tx: left, ty: top }
    const sx = (x: number) => left + x * cellPose.kx
    const sy = (y: number) => top + y * cellPose.ky
    const ink = union(roles.map((role) => role.box))
    const splitPose = (role: RoleInk, amount: number): Pose => {
      const dx = (role.box.x1 + role.box.x2) / 2 - (ink.x1 + ink.x2) / 2
      const dy = (role.box.y1 + role.box.y2) / 2 - (ink.y1 + ink.y2) / 2
      const length = Math.hypot(dx, dy) || 1
      return { ...cellPose, tx: left + dx / length * size * 0.13 * amount, ty: top + dy / length * size * 0.13 * amount }
    }
    const tile = size * 0.27
    const tileGap = size * 0.05
    const tileAt = (index: number) => ({ x: left + size / 2 - (roles.length * tile + (roles.length - 1) * tileGap) / 2 + index * (tile + tileGap), y: top + (size - tile) / 2 })
    const tilePose = (role: RoleInk, index: number): Pose => {
      const { x, y } = tileAt(index)
      const k = tile * 0.72 / Math.max(role.box.x2 - role.box.x1, role.box.y2 - role.box.y1)
      return { kx: k, ky: k, tx: x + tile / 2 - (role.box.x1 + role.box.x2) / 2 * k, ty: y + tile / 2 - (role.box.y1 + role.box.y2) / 2 * k }
    }
    const composedPose = (role: RoleInk): Pose => {
      const target = composed[0].roles.find((item) => item.role === role.role)
      if (!target) return cellPose
      const kx = (target.box.x2 - target.box.x1) * fk / (role.box.x2 - role.box.x1)
      const ky = (target.box.y2 - target.box.y1) * fk / (role.box.y2 - role.box.y1)
      return { kx, ky, tx: fx(target.box.x1) - role.box.x1 * kx, ty: fy(target.box.y2) - role.box.y1 * ky }
    }
    const drawInk = (pose: Pose, own: (stroke: SpecimenStroke) => boolean, opacity = 1) => {
      alpha(opacity)
      context.fillStyle = INK
      for (const stroke of strokes) {
        if (!own(stroke)) continue
        context.setTransform(dpr * pose.kx, 0, 0, dpr * pose.ky, dpr * (pose.tx + stroke.x * pose.kx), dpr * (pose.ty + stroke.y * pose.ky))
        context.fill(stroke.outline, 'nonzero')
      }
      base()
      alpha(1)
    }
    const frameBox = (role: RoleInk, pose: Pose, opacity: number) => {
      const pad = mini ? 2 : 8
      const x = pose.tx + role.box.x1 * pose.kx - pad
      const y = pose.ty + role.box.y1 * pose.ky - pad
      const w = (role.box.x2 - role.box.x1) * pose.kx + pad * 2
      const h = (role.box.y2 - role.box.y1) * pose.ky + pad * 2
      alpha(opacity)
      if (role.role === 'medial') { context.fillStyle = LIME; context.fillRect(x, y, w, h) }
      hairline(x, y, w, h, INK, role.role === 'final' ? [4, 3] : [])
      if (!mini) label(`${ROLE_LABELS[role.role]} ${role.char}`, x, y - 8, 700, 13)
      alpha(1)
    }
    const centerline = (points: (stroke: SpecimenStroke) => Point[], widthOf: (stroke: SpecimenStroke) => number, color: string, dots: number) => {
      context.lineCap = 'round'
      context.lineJoin = 'round'
      for (const stroke of strokes) {
        const path = points(stroke).map(([x, y]) => [sx(x), sy(y)] as Point)
        context.strokeStyle = color
        context.lineWidth = widthOf(stroke)
        context.beginPath()
        path.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
        if (path.length === 1) context.lineTo(path[0][0] + 0.01, path[0][1])
        context.stroke()
        if (dots > 0 && !mini) {
          alpha(dots)
          context.fillStyle = color
          const every = Math.max(1, Math.round(path.length / 28))
          path.forEach(([x, y], index) => { if (index % every === 0) { context.beginPath(); context.arc(x, y, 2.5, 0, Math.PI * 2); context.fill() } })
          alpha(1)
        }
      }
    }
    /** A composed syllable as the font holds it, with the zones its jamo were fitted into. */
    const glyph = (item: Composed, zones: number) => {
      for (const part of item.roles) {
        const zone = part.zone
        if (zones <= 0 || !zone) continue
        alpha(zones)
        if (part.role === 'medial') { context.fillStyle = LIME; context.fillRect(fx(zone.x1), fy(zone.y2), (zone.x2 - zone.x1) * fk, (zone.y2 - zone.y1) * fk) }
        hairline(fx(zone.x1), fy(zone.y2), (zone.x2 - zone.x1) * fk, (zone.y2 - zone.y1) * fk, INK, part.role === 'final' ? [4, 3] : [])
        alpha(1)
      }
      context.setTransform(dpr * fk, 0, 0, -dpr * fk, dpr * fx(0), dpr * fy(0))
      context.fillStyle = INK
      for (const part of item.roles) context.fill(part.path, 'nonzero')
      base()
    }

    if (at === 0) return drawInk(cellPose, () => true)

    if (at === 1) {
      // Every whole syllable is measured: the height it stands at and the space left between its jamo.
      const grow = mini ? 1 : ease(span(u, 0.08, 0.45))
      const settle = mini ? 1 : ease(span(u, 0.55, 0.95))
      drawInk(cellPose, () => true, mini ? 0.35 : mix(1, 0.35, ease(span(u, 0, 0.3))))
      const tick = mini ? 2 : 4
      /** A dimension line with end ticks, drawn `grow` of the way from its start. */
      const dimension = (x1: number, y1: number, x2: number, y2: number, live: boolean) => {
        const ex = mix(x1, x2, grow)
        const ey = mix(y1, y2, grow)
        if (Math.hypot(ex - x1, ey - y1) < 1) return
        const upright = Math.abs(x2 - x1) < Math.abs(y2 - y1)
        context.lineCap = 'butt'
        if (live) {
          context.strokeStyle = LIME
          context.lineWidth = mini ? 3 : 7
          context.beginPath(); context.moveTo(x1, y1); context.lineTo(ex, ey); context.stroke()
        }
        context.strokeStyle = INK
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(x1, y1); context.lineTo(ex, ey)
        for (const [x, y] of [[x1, y1], [ex, ey]]) {
          context.moveTo(x - (upright ? tick : 0), y - (upright ? 0 : tick))
          context.lineTo(x + (upright ? tick : 0), y + (upright ? 0 : tick))
        }
        context.stroke()
      }
      // The height all syllables are brought to, as a band across the box.
      const bandTop = cellSize * (1 - (data.learned.center + data.learned.height / 2) / 1000)
      const bandBottom = cellSize * (1 - (data.learned.center - data.learned.height / 2) / 1000)
      if (settle > 0) {
        alpha(settle)
        context.setLineDash([1, 4])
        context.lineCap = 'round'
        context.strokeStyle = INK
        context.lineWidth = 1
        context.beginPath()
        for (const y of [bandTop, bandBottom]) { context.moveTo(left, Math.round(sy(y)) + 0.5); context.lineTo(left + size, Math.round(sy(y)) + 0.5) }
        context.stroke()
        context.setLineDash([])
        alpha(1)
      }
      const edge = sx(ink.x1) - (mini ? 3 : 12)
      dimension(edge, sy(mix(ink.y1, bandTop, settle)), edge, sy(mix(ink.y2, bandBottom, settle)), false)
      if (mini) return
      // Every measure is read as a share of the writing cell, which is what the composer keeps.
      const percent = (pixels: number) => `${Math.round(pixels / cellSize * 100)}%`
      const figure = (text: string, x: number, y: number, align: CanvasTextAlign) => {
        const shown = context.globalAlpha
        context.globalAlpha = shown * ease(span(u, 0.3, 0.5))
        label(text, x, y, 700, 12, align)
        context.globalAlpha = shown
      }
      figure(percent(mix(ink.y2 - ink.y1, bandBottom - bandTop, settle)), edge - 8, sy((ink.y1 + ink.y2) / 2) + 4, 'right')
      const [initial, medial, final] = [roles.find((role) => role.role === 'initial')?.box, roles.find((role) => role.role === 'medial')?.box, roles.find((role) => role.role === 'final')?.box]
      alpha(1 - settle * 0.6)
      if (initial && medial) {
        if (specimen.kind === 'vertical') {
          const y = (Math.max(initial.y1, medial.y1) + Math.min(initial.y2, medial.y2)) / 2
          dimension(sx(initial.x2), sy(y), sx(medial.x1), sy(y), true)
          figure(percent(medial.x1 - initial.x2), sx((initial.x2 + medial.x1) / 2), sy(y) - 10, 'center')
        } else {
          const x = (initial.x1 + initial.x2) / 2
          dimension(sx(x), sy(initial.y2), sx(x), sy(medial.y1), true)
          figure(percent(medial.y1 - initial.y2), sx(x) + 10, sy((initial.y2 + medial.y1) / 2) + 4, 'left')
        }
      }
      if (final && initial && medial) {
        const x = (final.x1 + final.x2) / 2
        const upper = Math.max(initial.y2, medial.y2)
        dimension(sx(x), sy(upper), sx(x), sy(final.y1), true)
        figure(percent(final.y1 - upper), sx(x) + 10, sy((upper + final.y1) / 2) + 4, 'left')
      }
      alpha(1)
      return
    }

    if (at === 2) {
      // Captured samples, then the same samples with the hand's tremor taken out.
      const steady = mini ? 1 : ease(span(u, 0.35, 0.85))
      if (!mini) drawInk(cellPose, () => true, mix(0.35, 0.1, ease(span(u, 0, 0.25))))
      if (steady > 0 && !mini) centerline((stroke) => stroke.raw, () => 5, LIME, 0)
      const settled = (stroke: SpecimenStroke) => stroke.raw.map(([x, y], index) => [mix(x, stroke.steady[index][0], steady), mix(y, stroke.steady[index][1], steady)] as Point)
      centerline(settled, () => mini ? 1 : 1.5, INK, ease(span(u, 0.05, 0.3)))
      const focus = specimen.focus
      if (mini || !focus) return
      // A glass over the place the correction moves the pen path most: the written path in lime, the corrected one in ink.
      const zoom = 4
      const radius = Math.round(size * 0.17)
      const cx = left + size - radius - 8
      const cy = top + radius + 8
      alpha(ease(span(u, 0.2, 0.4)))
      context.lineWidth = 1
      context.strokeStyle = INK
      context.beginPath(); context.arc(sx(focus[0]), sy(focus[1]), radius / zoom, 0, Math.PI * 2); context.stroke()
      context.save()
      context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2)
      context.fillStyle = '#fff'
      context.fill()
      context.clip()
      context.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (cx - sx(focus[0]) * zoom), dpr * (cy - sy(focus[1]) * zoom))
      context.lineCap = 'round'
      context.lineJoin = 'round'
      for (const [points, color, weight] of [[(stroke: SpecimenStroke) => stroke.raw, LIME, 7], [settled, INK, 2]] as const) {
        context.strokeStyle = color
        context.lineWidth = weight / zoom
        for (const stroke of strokes) {
          context.beginPath()
          points(stroke).forEach(([x, y], index) => index ? context.lineTo(sx(x), sy(y)) : context.moveTo(sx(x), sy(y)))
          context.stroke()
        }
      }
      context.restore()
      base()
      context.lineWidth = 1
      context.strokeStyle = INK
      context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.stroke()
      alpha(1)
      return
    }

    if (at === 3) {
      // The centreline takes the pen's width, then becomes the outline the font stores.
      const swell = ease(span(u, 0, 0.4))
      if (!mini && span(u, 0.4, 0.5) < 1) return centerline((stroke) => stroke.steady, (stroke) => mix(1.5, stroke.diameter * cellPose.kx, swell), INK, 0)
      // The contour itself: what the font file holds is this closed line, not the pen path inside it.
      for (const stroke of strokes) {
        context.setTransform(dpr * cellPose.kx, 0, 0, dpr * cellPose.ky, dpr * (left + stroke.x * cellPose.kx), dpr * (top + stroke.y * cellPose.ky))
        context.fillStyle = LIME
        context.fill(stroke.outline, 'nonzero')
        context.lineWidth = (mini ? 1 : 2) / cellPose.kx
        context.lineJoin = 'round'
        context.strokeStyle = INK
        context.stroke(stroke.outline)
      }
      base()
      if (!mini) drawInk(cellPose, () => true, ease(span(u, 0.78, 1)))
      return
    }

    if (at === 4) {
      // Strokes go to the jamo they belong to, by cell and writing order: each stroke shows its place in that order first.
      roles.forEach((role, index) => {
        const amount = mini ? 1 : ease(span(u, 0.3 + index * 0.12, 0.76 + index * 0.12))
        const pose = splitPose(role, amount)
        frameBox(role, pose, amount)
        drawInk(pose, (stroke) => stroke.role === role.role)
      })
      if (mini) return
      strokes.forEach((stroke, order) => {
        const role = roles.find((item) => item.role === stroke.role)
        if (!role) return
        const pose = splitPose(role, ease(span(u, 0.3 + roles.indexOf(role) * 0.12, 0.76 + roles.indexOf(role) * 0.12)))
        const x = pose.tx + stroke.raw[0][0] * pose.kx - 9
        const y = pose.ty + stroke.raw[0][1] * pose.ky - 9
        alpha(ease(span(u, order * 0.03, 0.14 + order * 0.03)))
        context.fillStyle = INK
        context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.fill()
        label(String(order + 1), x, y + 4, 700, 12, 'center', '#fff')
        alpha(1)
      })
      return
    }

    if (at === 5 || at === 6) {
      // Each jamo is brought to one size, whatever size it was written at.
      roles.forEach((role, index) => {
        const pose = at === 6 ? tilePose(role, index) : lerpPose(splitPose(role, 1), tilePose(role, index), ease(span(u, index * 0.1, 0.6 + index * 0.1)))
        frameBox(role, pose, 1)
        drawInk(pose, (stroke) => stroke.role === role.role)
      })
      if (at === 5) return
      // Under each jamo, the context forms it has: the written ones in ink, the borrowed ones filled in after.
      roles.forEach((role, index) => {
        const forms = specimen.forms.find((item) => item.role === role.role)?.written ?? []
        const unit = Math.max(2, Math.min(7, Math.floor((tile + 2) / 8) - 2))
        const corner = tileAt(index)
        forms.forEach((written, form) => {
          const x = Math.round(corner.x + form * (unit + 2))
          const y = Math.round(corner.y + tile + (mini ? 3 : 14))
          alpha(ease(span(u, 0.08 + form * 0.04, 0.4 + form * 0.04)))
          if (written) { context.fillStyle = INK; context.fillRect(x, y, unit, unit) }
          else {
            const borrowed = ease(span(u, 0.6, 0.9))
            context.fillStyle = LIME
            context.fillRect(x, y, unit, unit * borrowed)
            if (!mini) hairline(x, y, unit - 1, unit - 1, INK, borrowed < 1 ? [2, 2] : [])
          }
          alpha(1)
        })
        if (mini || tile < 48) return
        alpha(ease(span(u, 0.45, 0.7)))
        label(`${forms.length}벌 중 ${forms.filter(Boolean).length}벌 씀`, corner.x, corner.y + tile + 14 + unit + 18, 600, 12, 'left', INK_2)
        alpha(1)
      })
      return
    }

    if (at === 7) {
      // Composition: the jamo take their places in a syllable, then in other syllables.
      const placing = mini ? 1 : span(u, 0, 0.36)
      if (placing < 1) {
        for (const part of composed[0].roles) {
          if (!part.zone) continue
          alpha(ease(span(placing, 0, 0.5)))
          hairline(fx(part.zone.x1), fy(part.zone.y2), (part.zone.x2 - part.zone.x1) * fk, (part.zone.y2 - part.zone.y1) * fk, INK, part.role === 'final' ? [4, 3] : [])
          alpha(1)
        }
        roles.forEach((role, index) => {
          const pose = lerpPose(tilePose(role, index), composedPose(role), ease(span(placing, index * 0.12, 0.76 + index * 0.12)))
          drawInk(pose, (stroke) => stroke.role === role.role)
        })
        return
      }
      const item = mini ? composed[0] : composed[Math.min(composed.length - 1, Math.floor(span(u, 0.36, 1) * composed.length))]
      glyph(item, mini ? 0 : 1)
      if (mini) return
      label(item.char, left + size / 2, top + size + 40, 800, 26, 'center')
      label(item.note, left + size / 2, top + size + 62, 600, 12, 'center', INK_2)
      return
    }

    if (at === 8) {
      // A final is centred by rule: the middle of the bulk of its ink goes to a fixed share of the way from the left of the upper pair to the right of the vowel's stem.
      const optical = specimen.optical
      if (!optical) return glyph(composed[0], 0)
      const { body, stem, target, anchor, core, final } = optical
      // The final starts where centring its box would put it, and ends where centring its ink puts it.
      const settle = mini ? 1 : ease(span(u, 0.62, 0.9))
      const shift = (anchor - (final.x1 + final.x2) / 2) * (1 - settle)
      context.fillStyle = INK
      for (const part of optical.glyph.roles) {
        context.setTransform(dpr * fk, 0, 0, -dpr * fk, dpr * fx(part.role === 'final' ? shift : 0), dpr * fy(0))
        context.fill(part.path, 'nonzero')
      }
      base()
      const reach = mini ? 1 : ease(span(u, 0.05, 0.3))
      const aim = mini ? 1 : ease(span(u, 0.28, 0.5))
      const bulk = mini ? 0 : ease(span(u, 0.42, 0.62))
      const right = stem ? stem.x2 : body.x2
      const rule = Math.round(fy(body.y2) - (mini ? 3 : 14)) + 0.5
      const tick = mini ? 2 : 4
      // The span the rule measures, from the left of the upper pair to the right of the stem.
      context.strokeStyle = INK
      context.lineWidth = 1
      context.lineCap = 'butt'
      context.beginPath()
      context.moveTo(fx(body.x1), rule); context.lineTo(fx(mix(body.x1, right, reach)), rule)
      context.moveTo(fx(body.x1), rule - tick); context.lineTo(fx(body.x1), rule + tick)
      if (reach >= 1) { context.moveTo(fx(right), rule - tick); context.lineTo(fx(right), rule + tick) }
      context.stroke()
      if (aim > 0) {
        // Where the middle of the final belongs.
        alpha(aim)
        context.setLineDash([1, 4])
        context.lineCap = 'round'
        context.beginPath()
        context.moveTo(Math.round(fx(target)) + 0.5, rule); context.lineTo(Math.round(fx(target)) + 0.5, mix(rule, fy(final.y1) + (mini ? 2 : 22), aim))
        context.stroke()
        context.setLineDash([])
        context.fillStyle = INK
        context.beginPath(); context.arc(fx(target), rule, mini ? 1.5 : 3, 0, Math.PI * 2); context.fill()
        if (!mini) label(stem ? `${Math.round(STEM_SHARE * 100)}%` : '가운데', fx(target), rule - 10, 700, 12, 'center')
        alpha(1)
      }
      if (bulk > 0) {
        // Under the final: its whole width as a line, the bulk of its ink as a band, and the middle of that band.
        const y = Math.round(fy(final.y1) + 10)
        alpha(bulk)
        context.fillStyle = RULE
        context.fillRect(fx(final.x1 + shift), y + 2, (final.x2 - final.x1) * fk, 2)
        context.fillStyle = LIME
        context.fillRect(fx(core[0] + shift), y, (core[1] - core[0]) * fk, 6)
        context.fillStyle = INK
        context.fillRect(Math.round(fx(anchor + shift)) - 1, y - 3, 2, 12)
        alpha(1)
      }
      if (mini) return
      label(optical.glyph.char, left + size / 2, top + size + 40, 800, 26, 'center')
      label(stem ? '기둥까지 폭의 60% 지점' : '윗몸 한가운데', left + size / 2, top + size + 62, 600, 12, 'center', INK_2)
      return
    }

    // Overlapping strokes are separate closed lines until they are merged into one outline per glyph.
    const joined = mini ? 1 : ease(span(u, 0.3, 0.62))
    context.setTransform(dpr * fk, 0, 0, -dpr * fk, dpr * fx(0), dpr * fy(0))
    context.lineWidth = (mini ? 1 : 2) / fk
    context.lineJoin = 'round'
    context.strokeStyle = INK
    context.fillStyle = LIME
    if (joined < 1) {
      alpha(1 - joined)
      for (const part of composed[0].roles) { context.fill(part.path, 'nonzero'); context.stroke(part.path) }
    }
    alpha(joined)
    context.fill(specimen.merged, 'nonzero')
    context.stroke(specimen.merged)
    if (!mini) {
      alpha(ease(span(u, 0.78, 1)))
      context.fillStyle = INK
      context.fill(specimen.merged, 'nonzero')
    }
    alpha(1)
    base()
  }

  /** The results of the steps so far, kept in a row under the stage; each one docks there from the first specimen. */
  const drawTrail = () => {
    if (!specimens.length || frame.kind === 'none') return
    const pitch = Math.min(58, Math.floor((width - 64) / TRAIL))
    const size = pitch - 10
    const y = height - size - 24
    const x0 = Math.round((width - (TRAIL * pitch - 10)) / 2)
    for (let index = 0; index < TRAIL; index += 1) {
      alpha(1)
      const slot: Square = { left: x0 + index * pitch, top: y, side: size }
      if (index >= step) { hairline(slot.left, slot.top, size, size, index === step ? INK : RULE, index === step ? [] : [4, 3]); continue }
      // The result that has just been finished travels down from where it was made.
      const docking = index === step - 1 && frame.kind === 'full' && frame.bind < 0 ? ease(span(frame.time, cues[step], cues[step] + DOCK)) : 1
      const square = lerpSquare(box(0), slot, docking)
      if (docking < 1) hairline(slot.left, slot.top, size, size, INK)
      context.save()
      context.fillStyle = '#fff'
      context.fillRect(square.left, square.top, square.side, square.side)
      context.beginPath()
      context.rect(square.left, square.top, square.side, square.side)
      context.clip()
      const pad = square.side * 0.08
      drawSpecimen(specimens[0], { left: square.left + pad, top: square.top + pad, side: square.side - pad * 2 }, index, 1, true)
      context.restore()
      alpha(1)
      hairline(square.left, square.top, square.side, square.side, docking < 1 ? INK : RULE)
    }
    context.globalAlpha = 1
  }

  /** The sentence as it sat on the writing page; the specimens' cells move into their boxes and the rest fades. */
  const drawSentence = (u: number) => {
    const sentence = data.sentence!
    const fit = data.origin
      ? { k: data.origin.frame.width / sentence.width, x: data.origin.frame.x, y: data.origin.frame.y }
      : (() => { const k = Math.min((width - 96) / sentence.width, (height - 96) / sentence.height, 1.2); return { k, x: (width - sentence.width * k) / 2, y: (height - sentence.height * k) / 2 } })()
    const others = 1 - ease(span(u, 0.1, 0.45))
    const open = ease(span(u, 0.2, 0.6))
    context.save()
    if (data.origin && open < 1) {
      const clip = data.origin.clip
      context.beginPath()
      context.rect(mix(clip.x, 0, open), mix(clip.y, 0, open), mix(clip.width, width, open), mix(clip.height, height, open))
      context.clip()
    }
    context.fillStyle = INK
    const cells = new Set(specimens.map((specimen) => specimen.cellIndex))
    if (others > 0) {
      alpha(others)
      for (const item of sentence.paths) {
        if (cells.has(item.cellIndex)) continue
        context.setTransform(dpr * fit.k, 0, 0, dpr * fit.k, dpr * (fit.x + item.x * fit.k), dpr * (fit.y + item.y * fit.k))
        context.fill(item.path, 'nonzero')
      }
      base()
    }
    specimens.forEach((specimen, index) => {
      const target = box(index)
      const corner = cellOrigin(specimen.cellIndex, sentence.columns, sentence.cellSize)
      const zoom = ease(span(u, 0.25 + index * 0.06, 0.88 + index * 0.06))
      const k = mix(fit.k, target.side / sentence.cellSize, zoom)
      const x = mix(fit.x + corner.x * fit.k, target.left, zoom)
      const y = mix(fit.y + corner.y * fit.k, target.top, zoom)
      alpha(1)
      context.fillStyle = INK
      for (const item of sentence.paths) {
        if (item.cellIndex !== specimen.cellIndex) continue
        context.setTransform(dpr * k, 0, 0, dpr * k, dpr * (x + (item.x - corner.x) * k), dpr * (y + (item.y - corner.y) * k))
        context.fill(item.path, 'nonzero')
      }
      base()
      alpha(ease(span(u, 0.5, 1)))
      hairline(x, y, sentence.cellSize * k, sentence.cellSize * k, RULE)
    })
    context.restore()
    alpha(1)
  }

  /** The workers side by side, each composing its own run of initials; then their blocks joined in code order, and the preview sentence lifted out of them. */
  const drawLanes = () => {
    const staged = specimens.length > 0 && frame.kind !== 'none'
    const start = cues[LANES_STEP]
    const enter = staged ? ease(span(frame.time, start, start + 0.45)) : 1
    const joined = frame.bind >= 0 ? ease(span(frame.bind, 0, BIND_LENGTH * 0.85)) : 0
    const leave = frame.lift >= 0 ? ease(span(frame.lift, 0, 0.3)) : 0
    const lanes = frame.lanes.length ? frame.lanes : [frame.composed]
    const rollSide = Math.round(Math.min(180, height * 0.24))
    const roll: Square = { left: Math.round((width - rollSide) / 2), top: Math.round(Math.max(32, height * 0.08)), side: rollSide }
    const track = Math.round(Math.min(width - 200, 720))
    const x0 = Math.round((width - track) / 2)
    const blockTop = roll.top + roll.side + 80
    const stripTop = blockTop + (lanes.length - 1) * LANE_PITCH / 2
    const edges = Array.from({ length: lanes.length + 1 }, (_, lane) => Math.floor(INITIALS.length * lane / lanes.length))

    // The specimens leave; the first one's box becomes the window on the syllable being composed.
    veil = 1 - leave
    if (staged && enter < 1) {
      veil = 1 - enter
      specimens.forEach((specimen, index) => { if (index) { hairline(box(index).left, box(index).top, side, side, RULE); drawSpecimen(specimen, box(index), LANES_STEP - 1, 1, false) } })
      veil = 1 - leave
    }
    const pane = staged ? lerpSquare(box(0), roll, enter) : roll
    alpha(1)
    hairline(pane.left, pane.top, pane.side, pane.side, RULE)
    const rolling = Math.min(HANGUL_COUNT - 1, Math.floor(frame.composed * HANGUL_COUNT * 0.25) + Math.floor(frame.time * 11) * 37 % 588)
    const shown = frame.bind >= 0 || frame.kind === 'none' || enter < 0.5 ? undefined : data.compose(HANGUL_BASE + rolling)
    if (shown) {
      const fk = pane.side * EM_FIT / 1000
      context.setTransform(dpr * fk, 0, 0, -dpr * fk, dpr * (pane.left + pane.side * (1 - EM_FIT) / 2), dpr * (pane.top + pane.side * (1 - EM_FIT) / 2 + 900 * fk))
      context.fillStyle = INK
      alpha(1)
      for (const part of shown.roles) context.fill(part.path, 'nonzero')
      base()
    } else if (specimens.length) drawSpecimen(specimens[0], pane, LANES_STEP - 1, 1, false)
    alpha(enter)
    label(`${Math.round(frame.composed * HANGUL_COUNT).toLocaleString()} / ${HANGUL_COUNT.toLocaleString()}`, width / 2, pane.top + pane.side + 44, 800, 20, 'center')

    lanes.forEach((reported, lane) => {
      // The shown share only approaches its target; the last sliver is not a front.
      const done = reported > 0.998 ? 1 : reported
      const appear = staged ? ease(span(frame.time, start + 0.1 + lane * 0.03, start + 0.4 + lane * 0.03)) : 1
      const from = edges[lane] / INITIALS.length
      const share = (edges[lane + 1] - edges[lane]) / INITIALS.length
      const x = mix(x0, x0 + track * from, joined)
      const w = mix(track, track * share, joined)
      const y = Math.round(mix(blockTop + lane * LANE_PITCH, stripTop, joined) + (1 - appear) * 8)
      veil = frame.lift >= 0 ? 1 - ease(span(frame.lift, 0.35, 0.7)) : 1
      alpha(appear)
      context.fillStyle = RULE
      context.fillRect(x, y, w, LANE_HEIGHT)
      context.fillStyle = INK
      context.fillRect(x, y, w * done, LANE_HEIGHT)
      if (done > 0 && done < 1) { context.fillStyle = LIME; context.fillRect(x + w * done - Math.min(6, w * done), y, Math.min(6, w * done), LANE_HEIGHT) }
      veil = 1 - leave
      alpha(appear * (1 - joined))
      const first = INITIALS[edges[lane]]
      const last = INITIALS[edges[lane + 1] - 1]
      label(first === last ? first : `${first}–${last}`, x0 - 12, y + LANE_HEIGHT - 1, 600, 12, 'right', INK_2)
    })
    alpha(joined)
    label('가', x0 - 12, stripTop + LANE_HEIGHT - 1, 600, 12, 'right', INK_2)
    label('힣', x0 + track + 12, stripTop + LANE_HEIGHT - 1, 600, 12, 'left', INK_2)
    veil = 1
    alpha(1)

    // Each syllable of the preview sentence rises from its place among the 11,172 and takes its place in the line.
    if (frame.lift < 0 || !frame.targets) return
    data.line.forEach((item, order) => {
      const target = frame.targets![item.index]
      if (!target) return
      const amount = ease(span(frame.lift, order * LIFT_STAGGER, LIFT_TRAVEL + order * LIFT_STAGGER))
      const k = mix(LANE_HEIGHT, frame.em, amount) / 1000
      const x = mix(x0 + track * item.syllable / HANGUL_COUNT, target.x, amount)
      const baseline = mix(stripTop + LANE_HEIGHT, target.baseline, amount)
      alpha(span(frame.lift, order * LIFT_STAGGER, order * LIFT_STAGGER + 0.08))
      context.setTransform(dpr * k, 0, 0, -dpr * k, dpr * (x + item.dx * k), dpr * (baseline - item.dy * k))
      context.fillStyle = INK
      for (const part of item.glyph.roles) context.fill(part.path, 'nonzero')
      base()
    })
    alpha(1)
  }

  if (step >= LANES_STEP || !specimens.length) {
    drawLanes()
    veil = frame.lift >= 0 ? 1 - ease(span(frame.lift, 0, 0.3)) : 1
    drawTrail()
    veil = 1
    return
  }

  if (step === 0) drawSentence(local(0))
  else {
    const u = local(step)
    specimens.forEach((specimen, index) => {
      const square = box(index)
      hairline(square.left, square.top, side, side, RULE)
      drawSpecimen(specimen, square, step, span(u, index * 0.05, 0.9 + index * 0.05), false)
    })
    // What the step found, in the writer's own numbers.
    const caption = step === 1 ? `쓴 글자 ${data.learned.count.toLocaleString()}자에서 높이와 자모 사이 간격을 쟀어요 · 칸 크기 대비 %`
      : step === 6 ? `자모의 ${Math.round(data.exactShare * 100)}%는 그 자리에서 쓴 것을, 나머지는 가장 닮은 자리의 것을 써요`
      : step === 8 ? '받침은 상자 가운데가 아니라 잉크가 몰린 곳(라임 띠)의 가운데를 목표점에 맞춰요'
      : undefined
    if (caption) {
      alpha(ease(span(u, 0.2, 0.5)))
      label(caption, width / 2, rowTop + side + (step === 8 ? 92 : 44), 600, 14, 'center', INK_2)
      alpha(1)
    }
  }
  drawTrail()
}

/** What each step does to the handwriting, in one sentence, in step order; the last is the hand-over to the preview. */
export const FILM_NOTES = [
  '칸에 쓴 획을 좌표와 필압 그대로 가져옵니다. 모양이 다른 세 글자로 과정을 보여드려요.',
  '온전히 쓴 글자마다 높이와 자모 사이 간격을 재서, 조합할 때의 기준으로 삼습니다.',
  '획의 떨림과 끝의 갈고리를 덜어내고, 모서리는 남깁니다.',
  '펜 굵기와 필압을 입혀 폰트가 저장하는 윤곽선으로 바꿉니다.',
  '획을 시작한 칸과 쓴 순서로 초성·중성·종성을 나눕니다.',
  '쓴 크기가 달라도 자모마다 같은 기준 크기로 맞춥니다.',
  '같은 자모라도 놓이는 자리마다 모양이 달라요. 그 자리에서 쓴 것을 먼저 고르고, 없으면 가장 닮은 자리의 것을 빌립니다.',
  '모음 모양과 받침 유무에 맞는 자리에 자모를 놓아 글자를 만듭니다.',
  '받침은 상자가 아니라 잉크가 몰린 곳의 가운데를 기준으로, 모음 기둥까지 폭의 60% 지점에 놓습니다. 기둥이 없으면 윗몸 한가운데에 놓습니다.',
  '겹친 획의 윤곽을 글자마다 하나로 합칩니다.',
  '같은 방법으로 현대 한글 11,172자를 초성별로 나눠 동시에 조합합니다.',
  '나눠 만든 글리프를 코드 순서로 이어 OTF 파일 하나로 묶습니다.',
  '완성된 폰트에서 첫 문장을 꺼냅니다.',
] as const
