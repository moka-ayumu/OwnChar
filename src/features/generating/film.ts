import { WRITING_EXERCISES } from '@/collection/exercises'
import { ROLE_LABELS } from '@/collection/prompts'
import { cellOrigin } from '@/collection/records'
import { svgPathData } from '@/font/geometry/svg'
import type { Box, Point } from '@/font/geometry/path-ops'
import { visualCalibrationScale } from '@/font/glyphs/calibration'
import { decomposeHangul, HANGUL_BASE, HANGUL_COUNT, INITIALS, isHangulSyllable, syllableRoles, type HangulRole } from '@/font/hangul'
import { penDiameter, strokeSvgPath, type RawStroke } from '@/font/stroke/outline'
import { stabilizeStroke } from '@/font/stroke/stabilizer'
import { composedHangulParts, hangulComposeOptions, type HangulCompositionInputs } from '@/generation/font-builder'
import { learnCompositionProfile, shapesFromRequestDrawings, toRequestDrawings } from '@/generation/inputs'
import type { StageOrigin } from '@/lib/flow'
import type { ProjectState } from '@/project/types'

/** The stages of generation, in the order the film shows them. */
export const FILM_STEPS = ['원본 필기', '손떨림 보정', '윤곽선 만들기', '자모 분리', '크기 정규화', '문맥별 조합', '11,172자 조합', 'OTF 마무리'] as const
export const GRID_STEP = 6
export const FINISH_STEP = 7

const INK = '#101114'
const LIME = '#C6F432'
const RULE = '#D9DAD5'
const FONT = '"Wanted Sans Variable", "Wanted Sans", sans-serif'
/** Share of the specimen box a 1000-unit em takes. */
const EM_FIT = 0.84
const GRID_COLUMNS = 147
const GRID_ROWS = HANGUL_COUNT / GRID_COLUMNS

/** Start of each step in seconds, for the full film; the last entry is when the grid has had its minimum time. */
const FULL_CUES = [0, 1.5, 3.0, 4.2, 5.4, 6.4, 8.4, 9.6]
/** The short film opens on composition. */
const SHORT_CUES = [0, 0, 0, 0, 0, 0, 1.5, 3]

interface PlacedPath { path: Path2D; x: number; y: number; cellIndex: number }
interface SpecimenStroke { role: HangulRole | undefined; raw: Point[]; steady: Point[]; outline: Path2D; x: number; y: number; diameter: number }
interface RoleInk { role: HangulRole; char: string; box: Box }
interface ComposedRole { role: HangulRole; path: Path2D; box: Box; zone?: Box }
interface Composed { char: string; note: string; roles: ComposedRole[] }

export interface FilmData {
  sentence?: { paths: PlacedPath[]; width: number; height: number; cellSize: number; columns: number; cellIndex: number }
  specimen?: { char: string; cellSize: number; strokes: SpecimenStroke[]; roles: RoleInk[]; composed: Composed[] }
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

/** Reads the project into what the film draws: the sentence, one specimen syllable, and a composer for any syllable. */
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

  // The specimen is a syllable written whole in one cell, from the sentence the writer just left when possible.
  const order = [origin?.exerciseId, WRITING_EXERCISES[state.currentExercise]?.id, ...WRITING_EXERCISES.map((item) => item.id)]
  let best: { score: number; exerciseId: string; cellIndex: number } | undefined
  for (const exerciseId of new Set(order)) {
    const session = exerciseId ? state.writingSessions[exerciseId] : undefined
    const exercise = WRITING_EXERCISES.find((item) => item.id === exerciseId)
    if (!session || !exercise) continue
    const written = new Map<number, Set<number>>()
    for (const item of session.assignments) written.set(item.cellIndex, (written.get(item.cellIndex) ?? new Set()).add(item.slotIndex))
    for (const [cellIndex, slots] of written) {
      const cell = exercise.cells[cellIndex]
      if (!cell || !isHangulSyllable(cell.char.codePointAt(0)!)) continue
      const whole = slots.size === cell.slots.length
      const score = (whole ? 10 : 0) * cell.slots.length + slots.size
      if (!best || score > best.score) best = { score, exerciseId: exercise.id, cellIndex }
    }
    if (best && best.score >= 33) break
  }

  const sentenceId = best?.exerciseId ?? origin?.exerciseId
  const session = sentenceId ? state.writingSessions[sentenceId] : undefined
  if (!session) return { compose, origin: null }
  const exercise = WRITING_EXERCISES.find((item) => item.id === sentenceId)!
  const cellOf = new Map(session.assignments.map((item) => [item.elementId, item]))
  const live = session.elements.filter((stroke) => !stroke.isDeleted && stroke.points.length)
  const { cellSize, columns } = session
  const rows = Math.ceil(exercise.cells.length / columns)
  const sentence = {
    paths: live.map((stroke): PlacedPath => ({ path: new Path2D(strokeSvgPath(stroke, cellSize, strength)), x: stroke.x, y: stroke.y, cellIndex: cellOf.get(stroke.id)?.cellIndex ?? -1 })),
    width: columns * cellSize, height: rows * cellSize, cellSize, columns, cellIndex: best?.cellIndex ?? -1,
  }
  const film: FilmData = { sentence, compose, origin: origin?.exerciseId === sentenceId ? origin : null }
  if (!best) return film

  const cell = exercise.cells[best.cellIndex]
  const corner = cellOrigin(best.cellIndex, columns, cellSize)
  const strokes = live.filter((stroke) => cellOf.get(stroke.id)?.cellIndex === best.cellIndex).map((stroke: RawStroke): SpecimenStroke => {
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
    const own = strokes.filter((stroke) => stroke.role === slot.role)
    if (!slot.role || !own.length) return []
    return [{ role: slot.role, char: slot.char, box: union(own.map((stroke) => pointsBox(stroke.steady, stroke.diameter / 2))) }]
  })
  const codePoint = cell.char.codePointAt(0)!
  const { initialIndex, vowelIndex, finalIndex } = decomposeHangul(codePoint)
  const siblings = [
    ...[0, 8, 13, 20, 9, 4].filter((vowel) => vowel !== vowelIndex).map((vowel) => [initialIndex, vowel, finalIndex]),
    ...[0, 2, 11, 18].filter((initial) => initial !== initialIndex).map((initial) => [initial, vowelIndex, finalIndex]),
  ].map(([initial, vowel, final]) => compose(HANGUL_BASE + initial * 588 + vowel * 28 + final)).filter((item) => item !== undefined)
  const own = compose(codePoint)
  film.specimen = { char: cell.char, cellSize, strokes, roles, composed: own ? [own, ...siblings.slice(0, 6)] : [] }
  return film
}

export interface FilmFrame {
  /** Seconds since the film started. */
  time: number
  /** Share of the 11,172 syllables composed so far, 0 to 1. */
  composed: number
  /** 'none' draws only the grid, for reduced motion. */
  kind: 'full' | 'short' | 'none'
  /** The font is finished and the lead glyph is about to take over. */
  finishing: boolean
}

/** The step the film is on at `time`. */
export function filmStep(data: FilmData, kind: FilmFrame['kind'], time: number) {
  if (kind === 'none' || !data.specimen?.composed.length) return GRID_STEP
  const cues = kind === 'full' ? FULL_CUES : SHORT_CUES
  let step = kind === 'full' ? 0 : 5
  for (let index = step + 1; index <= GRID_STEP; index += 1) if (time >= cues[index]) step = index
  return step
}

/** How long the film runs before it may hand over to the preview. */
export function filmLength(data: FilmData, kind: FilmFrame['kind']) {
  if (kind === 'none') return 0
  if (!data.specimen?.composed.length) return 2.4
  return (kind === 'full' ? FULL_CUES : SHORT_CUES)[FINISH_STEP]
}

/** Where a jamo's ink goes: cell pixels scaled by (kx, ky), then moved by (tx, ty). */
interface Pose { kx: number; ky: number; tx: number; ty: number }
const lerpPose = (from: Pose, to: Pose, amount: number): Pose => ({ kx: mix(from.kx, to.kx, amount), ky: mix(from.ky, to.ky, amount), tx: mix(from.tx, to.tx, amount), ty: mix(from.ty, to.ty, amount) })

/** Draws one frame of the generation film on a canvas of `width` by `height` CSS pixels. */
export function drawFilm(context: CanvasRenderingContext2D, width: number, height: number, dpr: number, data: FilmData, frame: FilmFrame) {
  const base = () => context.setTransform(dpr, 0, 0, dpr, 0, 0)
  base()
  context.clearRect(0, 0, width, height)
  let side = Math.round(Math.min(height * 0.56, width * 0.5, 460))
  let left = Math.round((width - side) / 2)
  let top = Math.round(height * 0.46 - side / 2)
  // Font units to stage pixels: the 1000-unit em sits inside the specimen box with a margin.
  const fk = () => side * EM_FIT / 1000
  const fx = (x: number) => left + side * (1 - EM_FIT) / 2 + x * fk()
  const fy = (y: number) => top + side * (1 - EM_FIT) / 2 + (900 - y) * fk()
  const step = filmStep(data, frame.kind, frame.time)
  const specimen = data.specimen?.composed.length ? data.specimen : undefined
  const cues = frame.kind === 'full' ? FULL_CUES : SHORT_CUES
  const local = (index: number) => span(frame.time, cues[index], cues[index + 1])

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

  // 11,172 syllables as one field, filled from where each worker starts.
  const drawGrid = (alpha: number) => {
    const unit = Math.max(2, Math.floor(Math.min((width - 64) / GRID_COLUMNS, (height - 64) / GRID_ROWS)))
    const x0 = Math.round((width - unit * GRID_COLUMNS) / 2)
    const y0 = Math.round((height - unit * GRID_ROWS) / 2)
    const workers = Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1))
    const starts = Array.from({ length: workers + 1 }, (_, id) => Math.floor(INITIALS.length * id / workers) * 588)
    context.globalAlpha = alpha
    context.fillStyle = RULE
    for (let index = 0; index < HANGUL_COUNT; index += 1) context.fillRect(x0 + index % GRID_COLUMNS * unit, y0 + Math.floor(index / GRID_COLUMNS) * unit, unit - 1, unit - 1)
    for (let id = 0; id < workers; id += 1) {
      const end = starts[id] + Math.round((starts[id + 1] - starts[id]) * frame.composed)
      for (let index = starts[id]; index < end; index += 1) {
        context.fillStyle = !frame.finishing && end - index <= GRID_COLUMNS ? LIME : INK
        context.fillRect(x0 + index % GRID_COLUMNS * unit, y0 + Math.floor(index / GRID_COLUMNS) * unit, unit - 1, unit - 1)
      }
    }
    context.globalAlpha = 1
  }

  /** A composed syllable in the specimen box, with the zones its jamo were fitted into. */
  const drawComposed = (item: Composed, zones: number, caption = true) => {
    const k = fk()
    for (const part of item.roles) {
      const zone = part.zone
      if (zones > 0 && zone) {
        context.globalAlpha = zones
        if (part.role === 'medial') { context.fillStyle = LIME; context.fillRect(fx(zone.x1), fy(zone.y2), (zone.x2 - zone.x1) * k, (zone.y2 - zone.y1) * k) }
        hairline(fx(zone.x1), fy(zone.y2), (zone.x2 - zone.x1) * k, (zone.y2 - zone.y1) * k, INK, part.role === 'final' ? [4, 3] : [])
        context.globalAlpha = 1
      }
    }
    context.setTransform(dpr * k, 0, 0, -dpr * k, dpr * fx(0), dpr * fy(0))
    context.fillStyle = INK
    for (const part of item.roles) context.fill(part.path, 'nonzero')
    base()
    if (caption) {
      label(item.char, width / 2, top + side + 44, 800, 28, 'center')
      label(item.note, width / 2, top + side + 68, 600, 12, 'center', '#666970')
    }
  }

  if (step >= GRID_STEP || !specimen) {
    const enter = frame.kind === 'none' || !specimen ? 1 : ease(span(frame.time, cues[GRID_STEP], cues[GRID_STEP] + 0.6))
    drawGrid(enter)
    // The field needs the room: the specimen box gives up some of its size, about its own centre.
    const reduced = Math.round(side * mix(1, 0.62, enter))
    left += (side - reduced) / 2
    top += (side - reduced) / 2
    side = reduced
    context.fillStyle = frame.finishing ? LIME : '#fff'
    context.fillRect(left - 16, top - 16, side + 32, side + 84)
    hairline(left - 16, top - 16, side + 32, side + 84)
    if (frame.finishing) return
    // The syllable being composed right now, as the font will hold it.
    const index = Math.min(HANGUL_COUNT - 1, Math.floor(frame.composed * HANGUL_COUNT * 0.25) + Math.floor(frame.time * 11) * 37 % 588)
    const rolling = frame.kind === 'none' ? specimen?.composed[0] : data.compose(HANGUL_BASE + index) ?? specimen?.composed[Math.floor(frame.time * 11) % (specimen?.composed.length ?? 1)]
    if (rolling) drawComposed(rolling, 0, false)
    label(`${Math.round(frame.composed * HANGUL_COUNT).toLocaleString()} / ${HANGUL_COUNT.toLocaleString()}`, width / 2, top + side + 46, 800, 20, 'center')
    return
  }

  const { cellSize, strokes, roles, composed } = specimen
  const cellPose: Pose = { kx: side / cellSize, ky: side / cellSize, tx: left, ty: top }
  const center = union(roles.map((role) => role.box))
  const splitPose = (role: RoleInk, amount: number): Pose => {
    const dx = (role.box.x1 + role.box.x2) / 2 - (center.x1 + center.x2) / 2
    const dy = (role.box.y1 + role.box.y2) / 2 - (center.y1 + center.y2) / 2
    const length = Math.hypot(dx, dy) || 1
    return { ...cellPose, tx: left + dx / length * side * 0.13 * amount, ty: top + dy / length * side * 0.13 * amount }
  }
  const tile = side * 0.27
  const tilePose = (role: RoleInk, index: number): Pose => {
    const gap = side * 0.05
    const x = width / 2 - (roles.length * tile + (roles.length - 1) * gap) / 2 + index * (tile + gap)
    const y = top + (side - tile) / 2
    const k = tile * 0.72 / Math.max(role.box.x2 - role.box.x1, role.box.y2 - role.box.y1)
    return { kx: k, ky: k, tx: x + tile / 2 - (role.box.x1 + role.box.x2) / 2 * k, ty: y + tile / 2 - (role.box.y1 + role.box.y2) / 2 * k }
  }
  const composedPose = (role: RoleInk): Pose => {
    const target = composed[0].roles.find((item) => item.role === role.role)
    if (!target) return cellPose
    const k = fk()
    const kx = (target.box.x2 - target.box.x1) * k / (role.box.x2 - role.box.x1)
    const ky = (target.box.y2 - target.box.y1) * k / (role.box.y2 - role.box.y1)
    return { kx, ky, tx: fx(target.box.x1) - role.box.x1 * kx, ty: fy(target.box.y2) - role.box.y1 * ky }
  }
  const drawInk = (pose: Pose, own: (stroke: SpecimenStroke) => boolean, alpha = 1) => {
    context.globalAlpha = alpha
    context.fillStyle = INK
    for (const stroke of strokes) {
      if (!own(stroke)) continue
      context.setTransform(dpr * pose.kx, 0, 0, dpr * pose.ky, dpr * (pose.tx + stroke.x * pose.kx), dpr * (pose.ty + stroke.y * pose.ky))
      context.fill(stroke.outline, 'nonzero')
    }
    base()
    context.globalAlpha = 1
  }
  const frameBox = (role: RoleInk, pose: Pose, alpha: number, withLabel: boolean) => {
    const pad = 8
    const x = pose.tx + role.box.x1 * pose.kx - pad
    const y = pose.ty + role.box.y1 * pose.ky - pad
    const w = (role.box.x2 - role.box.x1) * pose.kx + pad * 2
    const h = (role.box.y2 - role.box.y1) * pose.ky + pad * 2
    context.globalAlpha = alpha
    if (role.role === 'medial') { context.fillStyle = LIME; context.fillRect(x, y, w, h) }
    hairline(x, y, w, h, INK, role.role === 'final' ? [4, 3] : [])
    if (withLabel) label(`${ROLE_LABELS[role.role]} ${role.char}`, x, y - 8, 700, 13)
    context.globalAlpha = 1
  }
  const centerline = (points: (stroke: SpecimenStroke) => Point[], widthOf: (stroke: SpecimenStroke) => number, color: string, dots: number) => {
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const stroke of strokes) {
      const line = points(stroke).map(([x, y]) => [left + x * cellPose.kx, top + y * cellPose.ky] as Point)
      context.strokeStyle = color
      context.lineWidth = widthOf(stroke)
      context.beginPath()
      line.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
      if (line.length === 1) context.lineTo(line[0][0] + 0.01, line[0][1])
      context.stroke()
      if (dots > 0) {
        context.globalAlpha = dots
        context.fillStyle = color
        const every = Math.max(1, Math.round(line.length / 28))
        line.forEach(([x, y], index) => { if (index % every === 0) { context.beginPath(); context.arc(x, y, 2.5, 0, Math.PI * 2); context.fill() } })
        context.globalAlpha = 1
      }
    }
  }

  if (step === 0) {
    // The sentence as it sat on the writing page, then only the specimen's cell.
    const u = local(0)
    const sentence = data.sentence!
    const fit = data.origin
      ? { k: data.origin.frame.width / sentence.width, x: data.origin.frame.x, y: data.origin.frame.y }
      : (() => { const k = Math.min((width - 96) / sentence.width, (height - 96) / sentence.height, 1.2); return { k, x: (width - sentence.width * k) / 2, y: (height - sentence.height * k) / 2 } })()
    const corner = cellOrigin(sentence.cellIndex, sentence.columns, sentence.cellSize)
    const zoom = ease(span(u, 0.3, 1))
    const k = mix(fit.k, cellPose.kx, zoom)
    const x = mix(fit.x, left - corner.x * cellPose.kx, zoom)
    const y = mix(fit.y, top - corner.y * cellPose.ky, zoom)
    const others = 1 - ease(span(u, 0.12, 0.5))
    context.save()
    if (data.origin && zoom < 1) {
      const clip = data.origin.clip
      context.beginPath()
      context.rect(mix(clip.x, 0, zoom), mix(clip.y, 0, zoom), mix(clip.width, width, zoom), mix(clip.height, height, zoom))
      context.clip()
    }
    context.fillStyle = INK
    for (const item of sentence.paths) {
      const own = item.cellIndex === sentence.cellIndex
      if (!own && others <= 0) continue
      context.globalAlpha = own ? 1 : others
      context.setTransform(dpr * k, 0, 0, dpr * k, dpr * (x + item.x * k), dpr * (y + item.y * k))
      context.fill(item.path, 'nonzero')
    }
    base()
    context.globalAlpha = ease(span(u, 0.5, 1))
    hairline(x + corner.x * k, y + corner.y * k, sentence.cellSize * k, sentence.cellSize * k, RULE)
    context.restore()
    context.globalAlpha = 1
    return
  }

  hairline(left, top, side, side, RULE)

  if (step === 1) {
    // Captured samples, then the same samples with the hand's tremor taken out.
    const u = local(1)
    const steady = ease(span(u, 0.35, 0.85))
    drawInk(cellPose, () => true, mix(1, 0.1, ease(span(u, 0, 0.25))))
    if (steady > 0) centerline((stroke) => stroke.raw, () => 5, LIME, 0)
    centerline((stroke) => stroke.raw.map(([x, y], index) => [mix(x, stroke.steady[index][0], steady), mix(y, stroke.steady[index][1], steady)] as Point), () => 1.5, INK, ease(span(u, 0.05, 0.3)))
    return
  }

  if (step === 2) {
    // The centreline takes the pen's width, then becomes the outline the font stores.
    const u = local(2)
    const swell = ease(span(u, 0, 0.4))
    const contour = span(u, 0.4, 0.5)
    const fill = ease(span(u, 0.78, 1))
    if (contour < 1) {
      centerline((stroke) => stroke.steady, (stroke) => mix(1.5, stroke.diameter * cellPose.kx, swell), INK, 0)
      return
    }
    // The contour itself: what the font file holds is this closed line, not the pen path inside it.
    for (const stroke of strokes) {
      context.setTransform(dpr * cellPose.kx, 0, 0, dpr * cellPose.ky, dpr * (left + stroke.x * cellPose.kx), dpr * (top + stroke.y * cellPose.ky))
      context.fillStyle = LIME
      context.fill(stroke.outline, 'nonzero')
      context.lineWidth = 2 / cellPose.kx
      context.lineJoin = 'round'
      context.strokeStyle = INK
      context.stroke(stroke.outline)
    }
    base()
    drawInk(cellPose, () => true, fill)
    return
  }

  if (step === 3) {
    // Strokes go to the jamo they belong to, by cell and writing order.
    const u = local(3)
    roles.forEach((role, index) => {
      const amount = ease(span(u, index * 0.14, 0.5 + index * 0.14))
      const pose = splitPose(role, amount)
      frameBox(role, pose, amount, true)
      drawInk(pose, (stroke) => stroke.role === role.role)
    })
    return
  }

  if (step === 4) {
    // Each jamo is brought to one size, whatever size it was written at.
    const u = local(4)
    roles.forEach((role, index) => {
      const amount = ease(span(u, index * 0.1, 0.6 + index * 0.1))
      const pose = lerpPose(splitPose(role, 1), tilePose(role, index), amount)
      frameBox(role, pose, 1, true)
      drawInk(pose, (stroke) => stroke.role === role.role)
    })
    return
  }

  // Composition: the jamo take their places in a syllable, then in other syllables.
  const u = frame.kind === 'full' ? local(5) : 1
  const placing = frame.kind === 'full' ? span(u, 0, 0.42) : 1
  if (placing < 1) {
    for (const part of composed[0].roles) {
      if (!part.zone) continue
      const k = fk()
      context.globalAlpha = ease(span(placing, 0, 0.5))
      hairline(fx(part.zone.x1), fy(part.zone.y2), (part.zone.x2 - part.zone.x1) * k, (part.zone.y2 - part.zone.y1) * k, INK, part.role === 'final' ? [4, 3] : [])
      context.globalAlpha = 1
    }
    roles.forEach((role, index) => {
      const pose = lerpPose(tilePose(role, index), composedPose(role), ease(span(placing, index * 0.12, 0.76 + index * 0.12)))
      drawInk(pose, (stroke) => stroke.role === role.role)
    })
    return
  }
  const elapsed = frame.kind === 'full' ? frame.time - (cues[5] + (cues[6] - cues[5]) * 0.42) : frame.time
  const index = Math.min(composed.length - 1, Math.floor(elapsed / 0.24))
  drawComposed(composed[index], 1)
}

/** What each step does to the handwriting, in one sentence, in step order. */
export const FILM_NOTES = [
  '칸에 쓴 획을 좌표와 필압 그대로 가져옵니다.',
  '획의 떨림과 끝의 갈고리를 덜어내고, 모서리는 남깁니다.',
  '펜 굵기와 필압을 입혀 폰트가 저장하는 윤곽선으로 바꿉니다.',
  '획을 시작한 칸과 쓴 순서로 초성·중성·종성을 나눕니다.',
  '쓴 크기가 달라도 자모마다 같은 기준 크기로 맞춥니다.',
  '모음 모양과 받침 유무에 맞는 자리에 자모를 놓아 글자를 만듭니다.',
  '같은 방법으로 현대 한글 11,172자를 모두 조합합니다.',
  '만든 글리프를 OTF 파일 하나로 묶습니다.',
] as const
