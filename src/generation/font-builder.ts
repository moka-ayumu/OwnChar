import opentype from 'opentype.js'
import { BASE_CHARACTER_PROMPTS, type CharacterPrompt } from '@/collection/prompts'
import { HANGUL_BASE, HANGUL_COUNT, HANGUL_ROLES } from '@/font/hangul'
import { prepareCffPath } from '@/font/geometry/cff'
import { mapPoints, pathOf, translatePath } from '@/font/geometry/path-ops'
import { appendShape, scaleZone, type NormalizedShape, type Zone } from '@/font/geometry/shape'
import { renderCalibratedGlyph, visualCalibrationScale, VISUAL_HANGUL_HEIGHT } from '@/font/glyphs/calibration'
import { composeStandaloneJamoPath, type ReferenceEnvelope } from '@/font/glyphs/standalone-jamo'
import { appendNumeral, appendSymbol, symbolCalibrationAnchor, symbolMaximumHeight } from '@/font/glyphs/symbols'
import { composeHangulParts, composeHangulPath, type HangulComposeOptions, type HangulParts } from '@/font/layout/compose-syllable'
import { alignVerticalCenter, medianHeight, normalizationFactor } from '@/font/metrics'
import type { CompositionSettings } from '@/font/settings'
import { shapesFromRequestDrawings } from './inputs'
import type { CompositionProfile, GenerationRequest, GlyphOverride } from './request'

export interface ComposeOptions {
  cancelled: () => boolean
  progress: (stage: string, progress: number, message: string) => void
  yieldControl?: () => Promise<void>
  precomposedHangul?: Map<number, opentype.Path['commands']>
  preparedContext?: PreparedCompositionContext
}

export interface HangulGlyphRecord { codePoint: number; commands: opentype.Path['commands'] }
export interface PreparedCompositionContext {
  shapes: Map<string, NormalizedShape>
  visualScale: number
}

/** The part of a generation request that decides how a Hangul syllable is composed. */
export type HangulCompositionInputs = CompositionProfile & { compositionSettings: CompositionSettings }

const LATIN_ZONE: Zone = { x: 90, y: 80, width: 820, height: 720 }

function glyphName(codePoint: number) {
  return `uni${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

function createNotdef() {
  const path = new opentype.Path()
  path.moveTo(80, 0)
  path.lineTo(80, 800)
  path.lineTo(620, 800)
  path.lineTo(620, 0)
  path.close()
  path.moveTo(150, 90)
  path.lineTo(550, 90)
  path.lineTo(550, 710)
  path.lineTo(150, 710)
  path.close()
  return new opentype.Glyph({ name: '.notdef', index: 0, advanceWidth: 700, path })
}

/** Letters sharing a height and baseline: capitals, x-height letters, ascenders, descenders. */
function latinClass(prompt: CharacterPrompt) {
  if (prompt.group === 'uppercase') return 'uppercase'
  if ('bdfhklt'.includes(prompt.char)) return 'lowercase-tall'
  if ('gjpqy'.includes(prompt.char)) return 'lowercase-descender'
  return 'lowercase-x'
}

/** The per-glyph override on top of the global metrics. */
function mergedOverride(request: GenerationRequest, codePoint: number): GlyphOverride {
  const specific = request.overrides[codePoint]
  return {
    left: request.globalMetrics.left + (specific?.left ?? 0),
    right: request.globalMetrics.right + (specific?.right ?? 0),
    y: request.globalMetrics.y + (specific?.y ?? 0),
    scale: specific?.scale ?? 1,
    rotation: specific?.rotation ?? 0,
  }
}

/** Scales and rotates a glyph about the centre of its ink, then raises it. */
function applyOverride(path: opentype.Path, override: GlyphOverride) {
  const box = path.getBoundingBox()
  const centerX = (box.x1 + box.x2) / 2
  const centerY = (box.y1 + box.y2) / 2
  const radians = override.rotation * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  mapPoints(path.commands, (px, py) => {
    const x = (px - centerX) * override.scale
    const y = (py - centerY) * override.scale
    return [x * cos - y * sin + centerX, x * sin + y * cos + centerY + override.y]
  })
}

function glyphWithMetrics(codePoint: number, path: opentype.Path, baseAdvanceWidth: number, override: GlyphOverride, mode: CompositionSettings['widthMode']) {
  if (path.commands.length) applyOverride(path, override)
  path = prepareCffPath(path)
  let advanceWidth = baseAdvanceWidth + override.left + override.right
  if (path.commands.length && mode === 'proportional') {
    const box = path.getBoundingBox()
    const leftBearing = 55 + override.left
    const rightBearing = 55 + override.right
    translatePath(path, leftBearing - box.x1, 0)
    advanceWidth = Math.max(100, leftBearing + box.x2 - box.x1 + rightBearing)
  } else if (path.commands.length && override.left) {
    translatePath(path, override.left, 0)
  }
  return new opentype.Glyph({ name: glyphName(codePoint), unicode: codePoint, advanceWidth, path })
}

export function hangulComposeOptions(request: CompositionProfile): Required<Pick<HangulComposeOptions, 'gaps' | 'proportions' | 'targetHeight' | 'targetCenter'>> {
  return { gaps: request.gaps, proportions: request.proportions, targetHeight: request.hangulTargetHeight, targetCenter: request.hangulTargetCenter }
}

export function prepareCompositionContext(request: GenerationRequest): PreparedCompositionContext {
  const shapes = shapesFromRequestDrawings(request.drawings, request.compositionSettings)
  return { shapes, visualScale: visualCalibrationScale(shapes, request.compositionSettings, hangulComposeOptions(request)) }
}

/** The ink envelope of 가, which standalone jamo are sized against. */
export function jamoReference(shapes: Map<string, NormalizedShape>, request: HangulCompositionInputs, visualScale: number): ReferenceEnvelope {
  const path = composeHangulPath('가'.codePointAt(0)!, shapes, request.compositionSettings, hangulComposeOptions(request))
  if (!path.commands.length) return { width: VISUAL_HANGUL_HEIGHT / visualScale, height: VISUAL_HANGUL_HEIGHT / visualScale, centerX: 500, centerY: request.hangulTargetCenter }
  const box = path.getBoundingBox()
  return { width: box.x2 - box.x1, height: box.y2 - box.y1, centerX: (box.x1 + box.x2) / 2, centerY: (box.y1 + box.y2) / 2 }
}

/** A syllable exactly as it is written to the font, before metrics and overrides. */
export function composedHangulPath(codePoint: number, shapes: Map<string, NormalizedShape>, request: HangulCompositionInputs, visualScale: number) {
  return composedHangulParts(codePoint, shapes, request, visualScale).path
}

/** Calibrated role geometry shared by export, previews, and diagnostics. */
export function composedHangulParts(codePoint: number, shapes: Map<string, NormalizedShape>, request: HangulCompositionInputs, visualScale: number): HangulParts {
  const options = hangulComposeOptions(request)
  let result: HangulParts | undefined
  let original: opentype.BoundingBox | undefined
  const path = renderCalibratedGlyph(
    (penScale) => {
      result = composeHangulParts(codePoint, shapes, request.compositionSettings, { ...options, penScale })
      original = result.path.getBoundingBox()
      return result.path
    },
    visualScale, request.hangulTargetCenter, 450, request.compositionSettings.widthMode === 'fixed',
  )
  const box = path.getBoundingBox()
  if (original && path.commands.length) {
    // Carry the calibration over to the role geometry.
    const scale = (box.y2 - box.y1) / Math.max(1e-6, original.y2 - original.y1)
    const dx = box.x1 - original.x1 * scale; const dy = box.y1 - original.y1 * scale
    const { zones, anchors, scales } = result!.geometry
    for (const role of HANGUL_ROLES) {
      const zone = zones[role]
      if (zone) zones[role] = { x1: zone.x1 * scale + dx, y1: zone.y1 * scale + dy, x2: zone.x2 * scale + dx, y2: zone.y2 * scale + dy }
      const anchor = anchors[role]
      if (anchor) anchors[role] = { x: anchor.x * scale + dx, y: anchor.y * scale + dy }
      if (scales[role] !== undefined) scales[role]! *= scale
    }
  }
  return result!
}

export async function precomposeHangulRange(request: GenerationRequest, start: number, end: number, progress?: (completed: number) => void, prepared?: PreparedCompositionContext) {
  const { shapes, visualScale } = prepared ?? prepareCompositionContext(request)
  const records: HangulGlyphRecord[] = []
  for (let index = start; index < end; index += 1) {
    const codePoint = HANGUL_BASE + index
    records.push({ codePoint, commands: composedHangulPath(codePoint, shapes, request, visualScale).commands })
    if ((index - start) % 112 === 0) progress?.(index - start + 1)
  }
  progress?.(end - start)
  return records
}

/** Standalone jamo, Latin letters, numerals and the symbols that were written. */
function composeBaseGlyphs(request: GenerationRequest, shapes: Map<string, NormalizedShape>, visualScale: number) {
  const settings = request.compositionSettings
  const fixedWidth = settings.widthMode === 'fixed'
  const reference = jamoReference(shapes, request, visualScale)

  // Letters of one class are normalized toward the median height and centre of that class.
  const heights = new Map<string, number[]>()
  const centers = new Map<string, number[]>()
  for (const prompt of BASE_CHARACTER_PROMPTS) {
    const shape = shapes.get(prompt.char)
    if (!shape || (prompt.group !== 'uppercase' && prompt.group !== 'lowercase')) continue
    const path = new opentype.Path()
    appendShape(path, shape, LATIN_ZONE)
    const box = path.getBoundingBox()
    const group = latinClass(prompt)
    heights.set(group, [...(heights.get(group) ?? []), box.y2 - box.y1])
    centers.set(group, [...(centers.get(group) ?? []), (box.y1 + box.y2) / 2])
  }
  const targetHeight = (prompt: CharacterPrompt) => medianHeight(heights.get(latinClass(prompt)) ?? [], 720)
  const targetCenter = (prompt: CharacterPrompt) => medianHeight(centers.get(latinClass(prompt)) ?? [], 440)

  const glyphs: opentype.Glyph[] = []
  for (const prompt of BASE_CHARACTER_PROMPTS) {
    const shape = shapes.get(prompt.char)
    if (prompt.group === 'symbol' && !shape) continue
    const isJamo = prompt.group === 'consonant' || prompt.group === 'vowel'
    const isMark = prompt.group === 'symbol' || prompt.group === 'number'
    // Numerals are tall marks: they take the anchor and height limit of `!`.
    const markChar = prompt.group === 'number' ? '!' : prompt.char
    const render = (penScale: number) => {
      const path = new opentype.Path()
      if (!shape) return path
      if (prompt.group === 'symbol') appendSymbol(path, prompt.char, shape, penScale)
      else if (prompt.group === 'number') appendNumeral(path, shape, penScale)
      else if (isJamo) return pathOf(composeStandaloneJamoPath(shape, settings, reference, penScale).commands)
      else {
        appendShape(path, shape, LATIN_ZONE, false, penScale)
        const box = path.getBoundingBox()
        const factor = normalizationFactor(box.y2 - box.y1, targetHeight(prompt), settings.latinNormalization)
        if (Math.abs(factor - 1) > 0.005) {
          path.commands.length = 0
          appendShape(path, shape, scaleZone(LATIN_ZONE, factor), false, penScale)
        }
        alignVerticalCenter(path, targetCenter(prompt), settings.verticalAlignment)
      }
      return path
    }
    const anchor = isMark ? symbolCalibrationAnchor(markChar) : isJamo ? request.hangulTargetCenter : targetCenter(prompt)
    const path = renderCalibratedGlyph(render, visualScale, anchor, isJamo ? 450 : anchor, fixedWidth, isMark ? symbolMaximumHeight(markChar) : 950)
    const baseAdvanceWidth = isJamo ? 1000 : prompt.group === 'symbol' ? 500 : 680
    glyphs.push(glyphWithMetrics(prompt.codePoint, path, baseAdvanceWidth, mergedOverride(request, prompt.codePoint), settings.widthMode))
  }
  return glyphs
}

export async function composeFont(request: GenerationRequest, options: ComposeOptions) {
  const { shapes, visualScale } = options.preparedContext ?? prepareCompositionContext(request)
  const glyphs: opentype.Glyph[] = [createNotdef()]
  glyphs.push(new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 400, path: new opentype.Path() }))

  options.progress('latin', options.precomposedHangul ? 94 : 2, '영문과 숫자를 정리하고 있어요')
  glyphs.push(...composeBaseGlyphs(request, shapes, visualScale))

  if (!options.precomposedHangul) options.progress('hangul', 3, '한글 음절을 조합하고 있어요')
  for (let index = 0; index < HANGUL_COUNT; index++) {
    if (options.cancelled()) throw new DOMException('Generation cancelled', 'AbortError')
    const codePoint = HANGUL_BASE + index
    const commands = options.precomposedHangul?.get(codePoint) ?? composedHangulPath(codePoint, shapes, request, visualScale).commands
    glyphs.push(glyphWithMetrics(codePoint, pathOf(commands), 1000, mergedOverride(request, codePoint), request.compositionSettings.widthMode))

    if (!options.precomposedHangul && index % 112 === 0) {
      const progress = 3 + Math.round((index / HANGUL_COUNT) * 91)
      options.progress('hangul', progress, `${index.toLocaleString()} / ${HANGUL_COUNT.toLocaleString()} 글자 조합 중`)
      await options.yieldControl?.()
    }
  }

  options.progress('serialize', 96, 'OTF 파일을 마무리하고 있어요')
  const font = new opentype.Font({
    familyName: request.metadata.familyName,
    styleName: request.metadata.styleName,
    designer: request.metadata.designer,
    manufacturer: 'OwnChar',
    version: request.metadata.version,
    unitsPerEm: 1000,
    ascender: 900,
    descender: -100,
    glyphs,
  })
  return { buffer: font.toArrayBuffer(), glyphCount: glyphs.length }
}
