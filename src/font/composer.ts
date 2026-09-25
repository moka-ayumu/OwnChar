import opentype from 'opentype.js'
import { BASE_CHARACTER_PROMPTS, CHARACTER_PROMPTS } from '@/lib/prompts'
import type { CharacterPrompt, GenerationRequest, GlyphOverride } from '@/types/project'
import { composeHangulPath, variantShapeKey } from './hangul'
import { appendShape, normalizeRawStrokes, normalizeStrokePaths, transformPath, type NormalizedShape, type Zone } from './path-geometry'
import { medianHeight, normalizationFactor } from './size-normalization'
import { alignVerticalCenter } from './vertical-alignment'
import { appendSymbol } from './symbol-placement'
import { composeStandaloneJamoPath, type ReferenceEnvelope } from './standalone-initial'
import { calibrateGlyphPath, symbolCalibrationAnchor, symbolMaximumHeight, visualCalibrationScale, VISUAL_HANGUL_HEIGHT } from './visual-calibration'
import { prepareCffPath } from './cff-outline'

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

function baseClass(prompt: CharacterPrompt) {
  if (prompt.group === 'consonant' || prompt.group === 'vowel') return prompt.group
  if (prompt.group === 'symbol') return 'symbol'
  if (prompt.group === 'uppercase') return 'uppercase'
  if (prompt.group === 'number') return 'number'
  if ('bdfhklt'.includes(prompt.char)) return 'lowercase-tall'
  if ('gjpqy'.includes(prompt.char)) return 'lowercase-descender'
  return 'lowercase-x'
}

function baseZone(prompt: CharacterPrompt): Zone {
  return prompt.group === 'consonant' || prompt.group === 'vowel'
    ? { x: 100, y: 80, width: 800, height: 760 }
    : { x: 90, y: 80, width: 820, height: 720 }
}

function scaledZone(zone: Zone, factor: number): Zone {
  return {
    x: zone.x + zone.width * (1 - factor) / 2,
    y: zone.y + zone.height * (1 - factor) / 2,
    width: zone.width * factor,
    height: zone.height * factor,
  }
}

function inkHeight(path: opentype.Path) {
  if (!path.commands.length) return 0
  const box = path.getBoundingBox()
  return box.y2 - box.y1
}

function glyphWithMetrics(codePoint: number, path: opentype.Path, baseAdvanceWidth: number, override: GlyphOverride, mode: 'proportional' | 'fixed') {
  if (path.commands.length) transformPath(path, { ...override, left: 0, right: 0 })
  path = prepareCffPath(path)
  let advanceWidth = baseAdvanceWidth + override.left + override.right
  if (path.commands.length && mode === 'proportional') {
    const box = path.getBoundingBox()
    const leftBearing = 55 + override.left
    const rightBearing = 55 + override.right
    const dx = leftBearing - box.x1
    for (const command of path.commands as Array<Record<string, any>>) {
      for (const x of ['x', 'x1', 'x2']) if (typeof command[x] === 'number') command[x] += dx
    }
    advanceWidth = Math.max(100, leftBearing + box.x2 - box.x1 + rightBearing)
  } else if (path.commands.length && override.left) {
    for (const command of path.commands as Array<Record<string, any>>) {
      for (const x of ['x', 'x1', 'x2']) if (typeof command[x] === 'number') command[x] += override.left
    }
  }
  return new opentype.Glyph({ name: glyphName(codePoint), unicode: codePoint, advanceWidth, path })
}

function shapesForRequest(request: GenerationRequest) {
  const shapes = new Map<string, NormalizedShape>()
  for (const prompt of CHARACTER_PROMPTS) {
    const drawing = request.drawings[prompt.id]
    const source = drawing?.sourcePromptId ? request.drawings[drawing.sourcePromptId] ?? drawing : drawing
    const paths = source?.paths
    const raw = source?.elements?.filter((element) => Array.isArray(element.points) && element.points.length > 0) ?? []
    if (raw.length || paths?.length) {
      const key = prompt.variantRole === undefined ? prompt.char : variantShapeKey(prompt.variantRole, prompt.variantIndex!, prompt.char)
      const shape = raw.length
        ? normalizeRawStrokes(raw, source?.cellSize ?? 148, request.compositionSettings.endpointStabilization)
        : normalizeStrokePaths(paths!, source?.cellSize)
      shape.sourceCellId = source?.sourceCellId
      const derivedRole = drawing?.sourcePromptId?.split('-')[0]
      if (derivedRole === 'initial' || derivedRole === 'medial' || derivedRole === 'final') shape.sourceRole = derivedRole
      shapes.set(key, shape)
    }
  }
  return shapes
}

export function prepareCompositionContext(request: GenerationRequest): PreparedCompositionContext {
  const shapes = shapesForRequest(request)
  return {
    shapes,
    visualScale: visualCalibrationScale(shapes, request.compositionSettings, request.gaps, request.hangulTargetHeight, request.hangulTargetCenter),
  }
}

function composedHangulPath(codePoint: number, shapes: Map<string, NormalizedShape>, request: GenerationRequest, visualScale: number) {
  const path = composeHangulPath(codePoint, shapes, request.compositionSettings, { gaps: request.gaps, targetHeight: request.hangulTargetHeight, targetCenter: request.hangulTargetCenter, postScale: visualScale })
  calibrateGlyphPath(path, visualScale, request.hangulTargetCenter, 450, request.compositionSettings.widthMode === 'fixed')
  return path
}

export async function precomposeHangulRange(request: GenerationRequest, start: number, end: number, progress?: (completed: number) => void, prepared?: PreparedCompositionContext) {
  const { shapes, visualScale } = prepared ?? prepareCompositionContext(request)
  const records: HangulGlyphRecord[] = []
  for (let index = start; index < end; index += 1) {
    const codePoint = 0xac00 + index
    records.push({ codePoint, commands: composedHangulPath(codePoint, shapes, request, visualScale).commands })
    if ((index - start) % 112 === 0) progress?.(index - start + 1)
  }
  progress?.(end - start)
  return records
}

export async function composeFont(request: GenerationRequest, options: ComposeOptions) {
  const { shapes, visualScale } = options.preparedContext ?? prepareCompositionContext(request)
  const gaPath = composeHangulPath('가'.codePointAt(0)!, shapes, request.compositionSettings, {
    gaps: request.gaps,
    targetHeight: request.hangulTargetHeight,
    targetCenter: request.hangulTargetCenter,
    postScale: visualScale,
  })
  const gaReference: ReferenceEnvelope = gaPath.commands.length ? (() => {
    const box = gaPath.getBoundingBox()
    return { width: box.x2 - box.x1, height: box.y2 - box.y1, centerX: (box.x1 + box.x2) / 2, centerY: (box.y1 + box.y2) / 2 }
  })() : { width: VISUAL_HANGUL_HEIGHT / visualScale, height: VISUAL_HANGUL_HEIGHT / visualScale, centerX: 500, centerY: request.hangulTargetCenter }

  const glyphs: opentype.Glyph[] = [createNotdef()]
  glyphs.push(new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 400, path: new opentype.Path() }))

  options.progress('latin', options.precomposedHangul ? 94 : 2, '영문과 숫자를 정리하고 있어요')
  const baseHeights = new Map<string, number[]>()
  const baseCenters = new Map<string, number[]>()
  for (const prompt of BASE_CHARACTER_PROMPTS) {
    if (prompt.group === 'symbol') continue
    const shape = shapes.get(prompt.char)
    if (!shape) continue
    const path = new opentype.Path()
    appendShape(path, shape, baseZone(prompt))
    const group = baseClass(prompt)
    baseHeights.set(group, [...(baseHeights.get(group) ?? []), inkHeight(path)])
    const box = path.getBoundingBox()
    baseCenters.set(group, [...(baseCenters.get(group) ?? []), (box.y1 + box.y2) / 2])
  }
  const baseTargets = new Map([...baseHeights].map(([group, heights]) => [group, medianHeight(heights, 720)]))
  const centerTargets = new Map([...baseCenters].map(([group, centers]) => [group, medianHeight(centers, 440)]))
  for (const prompt of BASE_CHARACTER_PROMPTS) {
    const shape = shapes.get(prompt.char)
    if (prompt.group === 'symbol' && !shape) continue
    const path = new opentype.Path()
    const isJamo = prompt.group === 'consonant' || prompt.group === 'vowel'
    if (shape) {
      if (prompt.group === 'symbol') appendSymbol(path, prompt.char, shape)
      else if (isJamo) path.commands.push(...composeStandaloneJamoPath(
        shape,
        request.compositionSettings,
        gaReference,
      ).commands)
      else {
      const zone = baseZone(prompt)
      appendShape(path, shape, zone)
      const strength = prompt.group === 'number' ? request.compositionSettings.numberNormalization
          : request.compositionSettings.latinNormalization
      const target = baseTargets.get(baseClass(prompt)) ?? 720
      const factor = normalizationFactor(inkHeight(path), target, strength)
      if (Math.abs(factor - 1) > 0.005) {
        path.commands.length = 0
        appendShape(path, shape, scaledZone(zone, factor))
      }
      alignVerticalCenter(path, centerTargets.get(baseClass(prompt)) ?? 440, request.compositionSettings.verticalAlignment)
      }
    }
    if (path.commands.length) {
      const anchor = prompt.group === 'symbol' ? symbolCalibrationAnchor(prompt.char)
        : isJamo ? request.hangulTargetCenter : centerTargets.get(baseClass(prompt)) ?? 440
      calibrateGlyphPath(path, visualScale, anchor, isJamo ? 450 : anchor, request.compositionSettings.widthMode === 'fixed', prompt.group === 'symbol' ? symbolMaximumHeight(prompt.char) : 950)
    }
    const specific = request.overrides[prompt.codePoint]
    const override = {
      left: request.globalMetrics.left + (specific?.left ?? 0),
      right: request.globalMetrics.right + (specific?.right ?? 0),
      y: request.globalMetrics.y + (specific?.y ?? 0),
      scale: specific?.scale ?? 1,
      rotation: specific?.rotation ?? 0,
    }
    const baseAdvanceWidth = isJamo ? 1000 : prompt.group === 'symbol' ? 500 : 680
    glyphs.push(glyphWithMetrics(prompt.codePoint, path, baseAdvanceWidth, override, request.compositionSettings.widthMode))
  }

  if (!options.precomposedHangul) options.progress('hangul', 3, '한글 음절을 조합하고 있어요')
  for (let index = 0; index < 11_172; index++) {
    if (options.cancelled()) throw new DOMException('Generation cancelled', 'AbortError')
    const codePoint = 0xac00 + index
    const specific = request.overrides[codePoint]
    const override = {
      left: request.globalMetrics.left + (specific?.left ?? 0),
      right: request.globalMetrics.right + (specific?.right ?? 0),
      y: request.globalMetrics.y + (specific?.y ?? 0),
      scale: specific?.scale ?? 1,
      rotation: specific?.rotation ?? 0,
    }
    const path = new opentype.Path()
    const precomposed = options.precomposedHangul?.get(codePoint)
    if (precomposed) path.commands.push(...precomposed)
    else path.commands.push(...composedHangulPath(codePoint, shapes, request, visualScale).commands)
    glyphs.push(glyphWithMetrics(codePoint, path, 1000, override, request.compositionSettings.widthMode))

    if (!options.precomposedHangul && index % 112 === 0) {
      const progress = 3 + Math.round((index / 11_172) * 91)
      options.progress('hangul', progress, `${index.toLocaleString()} / 11,172 글자 조합 중`)
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
    unitsPerEm: request.unitsPerEm,
    ascender: 900,
    descender: -100,
    glyphs,
  })
  return { buffer: font.toArrayBuffer(), glyphCount: glyphs.length }
}
