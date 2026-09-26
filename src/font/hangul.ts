import opentype from 'opentype.js'
import { appendShape, CELL_UNITS, type NormalizedShape, type Zone } from './path-geometry'
import type { CompositionSettings } from '@/types/project'
import type { HangulRole } from '@/types/project'
import { DEFAULT_GAPS, finalGapContext, finalGapPair, gapContext, gapPair, minimumGap, type GapKind, type GapProfile } from './gap-profile'
import { jamoSize, learnedRatios, proportionContext, proportionPair, type ProportionProfile } from './proportion-profile'
import { normalizationFactor } from './size-normalization'
import { maximizeSafeIntrusion } from './ink-collision'
import { conditionalGeometryAllows, overlapRule, type OverlapRuleDescriptor } from './overlap-policy'
import { selectJamoSource, sourceKey } from './source-selection'
import { alignVerticalCenter } from './vertical-alignment'

// Double and compound consonants are captured as complete glyphs as well.
export const CHOSEONG: string[][] = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'].map((char) => [char])

// Medials are captured as complete glyphs. A handwritten ㅐ or ㅘ is not
// reconstructed from separately captured ㅏ/ㅣ or ㅗ/ㅏ components.
export const JUNGSEONG: string[][] = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'].map((char) => [char])

export const JONGSEONG: string[][] = [[], ...[...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'].map((char) => [char])]

const verticalVowels = new Set([0, 1, 2, 3, 4, 5, 6, 7, 20])
const horizontalVowels = new Set([8, 12, 13, 17, 18])
const upwardVowels = new Set([8, 12])
const simpleVerticalVowels = new Set([0, 1, 2, 3, 4, 5, 6, 7, 20])
const noFinalInitialVariants = [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 3, 1, 2, 4, 4, 4, 2, 1, 3, 0]
const componentCaches = new WeakMap<Map<string, NormalizedShape>, Map<string, { commands: opentype.Path['commands']; sourceCellId?: string; pen: number }>>()
const intrusionCache = new Map<string, number>()
export function variantShapeKey(role: HangulRole, variantIndex: number, char: string) {
  return sourceKey(role, variantIndex, char)
}

function shapeFor(shapes: Map<string, NormalizedShape>, role: HangulRole, variantIndex: number, char: string) {
  const selected = selectJamoSource(shapes, role, variantIndex, char)
  return { shape: selected?.source, contextual: selected?.match === 'exact' || selected?.match === 'same-role', exact: selected?.match === 'exact', crossRole: selected?.match === 'cross-role' }
}

export function getHangulVariantSelection(codePoint: number) {
  const offset = codePoint - 0xac00
  const vowelIndex = Math.floor((offset % 588) / 28)
  const finalIndex = offset % 28
  const hasFinal = finalIndex > 0
  return {
    initial: hasFinal
      ? (simpleVerticalVowels.has(vowelIndex) ? 5 : horizontalVowels.has(vowelIndex) ? 6 : 7)
      : noFinalInitialVariants[vowelIndex],
    // These IDs describe handwriting shape contexts, so they must follow the
    // actual composition zones. The medial aspect changes only with a final;
    // final placement offsets are handled by composition, not by a new shape.
    medial: hasFinal ? 1 : 0,
    final: 0,
  }
}

function zonesFor(vowelIndex: number, hasFinal: boolean) {
  if (verticalVowels.has(vowelIndex)) {
    return hasFinal
      ? { initial: { x: 75, y: 340, width: 390, height: 520 }, vowel: { x: 515, y: 320, width: 400, height: 560 }, final: { x: 155, y: 75, width: 690, height: 220 } }
      : { initial: { x: 75, y: 155, width: 400, height: 700 }, vowel: { x: 520, y: 120, width: 395, height: 750 }, final: null }
  }
  if (horizontalVowels.has(vowelIndex)) {
    return hasFinal
      ? { initial: { x: 150, y: 610, width: 700, height: 285 }, vowel: { x: 110, y: 330, width: 780, height: 220 }, final: { x: 155, y: 65, width: 690, height: 220 } }
      : { initial: { x: 145, y: 500, width: 710, height: 350 }, vowel: { x: 100, y: 145, width: 800, height: 260 }, final: null }
  }
  return hasFinal
    ? {
        initial: { x: 90, y: 510, width: 430, height: 360 },
        vowel: { x: 90, y: 380, width: 820, height: 490 },
        mixedHorizontal: { x: 90, y: 390, width: 540, height: 170 },
        mixedVertical: { x: 590, y: 380, width: 320, height: 490 },
        final: { x: 155, y: 65, width: 690, height: 220 },
      }
    : {
        initial: { x: 90, y: 390, width: 450, height: 480 },
        vowel: { x: 90, y: 220, width: 820, height: 650 },
        mixedHorizontal: { x: 90, y: 260, width: 560, height: 200 },
        mixedVertical: { x: 600, y: 220, width: 310, height: 650 },
        final: null,
      }
}

function scaleZone(zone: Zone, scale: number): Zone {
  const width = zone.width * scale
  const height = zone.height * scale
  return { x: zone.x + (zone.width - width) / 2, y: zone.y + (zone.height - height) / 2, width, height }
}

function scaleGlyphZone(zone: Zone, scale: number): Zone {
  return {
    x: 500 + (zone.x - 500) * scale,
    y: 500 + (zone.y - 500) * scale,
    width: zone.width * scale,
    height: zone.height * scale,
  }
}

/**
 * Ink width of the pen, in font units, that `appendShape` gives this shape at
 * `penScale`. perfect-freehand treats its size as the radius at full pressure,
 * so the ink is twice the stored stroke size.
 */
function penUnits(shape: NormalizedShape, penScale: number) {
  const sizes = (shape.strokes ?? []).flatMap((stroke) => stroke.centerline
    ? [stroke.centerline.diameter * CELL_UNITS / stroke.centerline.cellSize]
    : [])
  return 2 * (sizes.length ? Math.max(...sizes) : minimumGap / 1.5) * penScale
}

/**
 * Normalization factors are almost unique per syllable. Rounding the pen
 * compensation keeps the component and outline caches effective while the
 * stroke width error stays below half a percent.
 */
function quantizePen(penScale: number) {
  return Math.round(penScale * 200) / 200
}

interface ComponentInfo { sourceCellId?: string; pen: number }

function appendComponents(path: opentype.Path, components: string[], zone: Zone, shapes: Map<string, NormalizedShape>, role: HangulRole, variantIndex: number, scale = 1, glyphScale = 1, postScale = 1, penScale = 1): ComponentInfo {
  let cache = componentCaches.get(shapes)
  if (!cache) {
    cache = new Map()
    componentCaches.set(shapes, cache)
  }
  const cacheKey = [role, variantIndex, components.join(','), zone.x, zone.y, zone.width, zone.height, scale, glyphScale, postScale, penScale].join(':')
  const cached = cache.get(cacheKey)
  if (cached) {
    path.commands.push(...cached.commands.map((command) => ({ ...command })))
    return { sourceCellId: cached.sourceCellId, pen: cached.pen }
  }
  const componentPath = new opentype.Path()
  let sourceCellId: string | undefined
  let pen = 0
  components.forEach((component) => {
    const { shape, contextual, exact, crossRole } = shapeFor(shapes, role, variantIndex, component)
    if (!shape) return
    sourceCellId = exact ? shape.sourceCellId : undefined
    pen = Math.max(pen, penUnits(shape, penScale))
    // Contextual jamo were drawn together inside a syllable cell. Keep that
    // shared coordinate system; only standalone fallback jamo need zone fitting.
    const preserveFrame = contextual && Boolean(shape.frame)
    const target = preserveFrame ? { x: 0, y: 0, width: 1000, height: 1000 } : zone
    // Cross-role fallbacks use the same aspect-preserving zone fit as an exact
    // final. A fixed width cap made borrowed 받침 visibly smaller than finals
    // captured in their own role.
    let placement = scaleGlyphZone(scaleZone(target, scale), glyphScale)
    if (crossRole && role !== 'final') {
      const nativeWidth = (shape.frame?.width ?? shape.aspectRatio * 0.4) * 1000
      const projectedWidth = Math.min(placement.width, placement.height * shape.aspectRatio)
      const cap = Math.min(placement.width * 0.75, nativeWidth, 270 / postScale)
      placement = scaleZone(placement, Math.min(1, cap / Math.max(1, projectedWidth)))
    }
    appendShape(componentPath, shape, placement, preserveFrame, penScale)
  })
  const commands = componentPath.commands.map((command) => ({ ...command }))
  cache.set(cacheKey, { commands, sourceCellId, pen })
  path.commands.push(...commands.map((command) => ({ ...command })))
  return { sourceCellId, pen }
}

function shift(path: opentype.Path, dx: number, dy: number) {
  for (const command of path.commands as Array<Record<string, any>>) {
    for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (typeof command[x] === 'number') command[x] += dx
      if (typeof command[y] === 'number') command[y] += dy
    }
  }
}

function scalePath(path: opentype.Path, factor: number) {
  const box = path.getBoundingBox()
  const centerX = (box.x1 + box.x2) / 2
  const centerY = (box.y1 + box.y2) / 2
  for (const command of path.commands as Array<Record<string, any>>) {
    for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (typeof command[x] === 'number') command[x] = centerX + (command[x] - centerX) * factor
      if (typeof command[y] === 'number') command[y] = centerY + (command[y] - centerY) * factor
    }
  }
}

function inkBox(path: opentype.Path) {
  return path.commands.length ? path.getBoundingBox() : null
}

function safelyOverlap(fixed: opentype.Path, moving: opentype.Path, rule: OverlapRuleDescriptor, requested: number, conditionalPath = moving, requireNegativeGap = true) {
  const diameter = minimumGap / 1.5
  if (!conditionalGeometryAllows(rule, conditionalPath, diameter)) return 0
  const maximum = Math.max(0, requested)
  const fingerprint = (path: opentype.Path) => path.commands.map((command) => {
    const values: string[] = [command.type]
    const record = command as unknown as Record<string, unknown>
    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2'] as const) {
      const value = record[key]
      if (typeof value === 'number') values.push(value.toFixed(4))
    }
    return values.join(',')
  }).join(';')
  const cacheKey = [rule.id, rule.axis, rule.direction, maximum.toFixed(2), fingerprint(fixed), fingerprint(moving)].join('|')
  let distance = intrusionCache.get(cacheKey)
  if (distance === undefined) {
    distance = maximizeSafeIntrusion(fixed, moving, {
      axis: rule.axis,
      direction: rule.direction,
      clearance: diameter * 0.5,
      maximum,
      step: diameter * 0.25,
    })
    if (intrusionCache.size > 5000) intrusionCache.clear()
    intrusionCache.set(cacheKey, distance)
  }
  // A candidate is useful only if it actually creates a negative bbox gap.
  if (distance <= 0 || (requireNegativeGap && distance <= minimumGap)) return 0
  shift(moving, rule.axis === 'x' ? rule.direction * distance : 0, rule.axis === 'y' ? rule.direction * distance : 0)
  return distance
}

function mixedHorizontalBox(path: opentype.Path) {
  const box = inkBox(path)
  if (!box) return null
  const cutoff = box.x1 + (box.x2 - box.x1) * 0.65
  const points = (path.commands as Array<Record<string, any>>).flatMap((command) => {
    const result: Array<[number, number]> = []
    for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (typeof command[x] === 'number' && typeof command[y] === 'number' && command[x] <= cutoff) result.push([command[x], command[y]])
    }
    return result
  })
  if (points.length < 2) return box
  return { x1: Math.min(...points.map(([x]) => x)), x2: Math.max(...points.map(([x]) => x)), y1: Math.min(...points.map(([, y]) => y)), y2: Math.max(...points.map(([, y]) => y)) }
}

export interface HangulComposeOptions {
  omitRoles?: HangulRole[]
  gaps?: GapProfile
  proportions?: ProportionProfile
  targetHeight?: number
  targetCenter?: number
  postScale?: number
  /** Pen width multiplier, used to cancel a uniform scale applied after composition. */
  penScale?: number
}

export interface HangulParts {
  path: opentype.Path
  /** Placed role outlines. They share command objects with `path`. */
  parts: Record<HangulRole, opentype.Path>
}

export function composeHangulPath(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options?: HangulComposeOptions) {
  return composeHangulParts(codePoint, shapes, settings, options).path
}

export function composeHangulParts(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options?: HangulComposeOptions): HangulParts {
  const offset = codePoint - 0xac00
  const initialIndex = Math.floor(offset / 588)
  const vowelIndex = Math.floor((offset % 588) / 28)
  const finalIndex = offset % 28
  const zones = zonesFor(vowelIndex, finalIndex > 0)
  const variants = getHangulVariantSelection(codePoint)
  const omitted = new Set(options?.omitRoles)
  const initials = CHOSEONG[initialIndex]
  const gaps = options?.gaps ?? DEFAULT_GAPS
  const kind: GapKind = verticalVowels.has(vowelIndex) ? 'vertical'
    : upwardVowels.has(vowelIndex) ? 'horizontalUp'
      : horizontalVowels.has(vowelIndex) ? 'horizontalDown' : 'mixed'
  const ratios = learnedRatios(
    options?.proportions,
    String.fromCodePoint(codePoint),
    proportionPair(initials[0], JUNGSEONG[vowelIndex][0], JONGSEONG[finalIndex][0]),
    proportionContext(kind, finalIndex > 0),
  )

  const build = (layoutScale: number, penScale: number) => {
    const initialPath = new opentype.Path()
    let medialPath = new opentype.Path()
    let finalPath = new opentype.Path()
    const appendMedial = (target: opentype.Path, factor: number) => appendComponents(target, JUNGSEONG[vowelIndex], zones.vowel, shapes, 'medial', variants.medial, settings.vowelScale * factor, layoutScale, 1, penScale)
    const appendFinal = (target: opentype.Path, factor: number) => appendComponents(target, JONGSEONG[finalIndex], zones.final!, shapes, 'final', variants.final, settings.finalScale * factor, layoutScale, 1, penScale)
    const initialInfo = !omitted.has('initial') ? appendComponents(initialPath, initials, zones.initial, shapes, 'initial', variants.initial, settings.singleInitialScale, layoutScale, options?.postScale, penScale) : undefined
    const medialInfo = !omitted.has('medial') ? appendMedial(medialPath, 1) : undefined
    const finalInfo = zones.final && !omitted.has('final') ? appendFinal(finalPath, 1) : undefined
    const initialSource = initialInfo?.sourceCellId
    const medialSource = medialInfo?.sourceCellId
    const finalSource = finalInfo?.sourceCellId

    // Follow the learned initial : medial : final size ratio. A role is
    // re-appended at a scaled zone, not scaled as an outline, so its pen width
    // stays the same; its center stays where the zone put it.
    const initialMeasure = initialInfo && inkBox(initialPath)
    if (ratios && initialMeasure && initialInfo) {
      const size = (role: HangulRole, box: NonNullable<ReturnType<typeof inkBox>>, pen: number) =>
        jamoSize(role, kind, box.x2 - box.x1 - pen, box.y2 - box.y1 - pen)
      const initialSize = size('initial', initialMeasure, initialInfo.pen)
      const resize = (role: 'medial' | 'final', current: opentype.Path, info: ComponentInfo | undefined, learned: number | undefined, append: (target: opentype.Path, factor: number) => ComponentInfo) => {
        const box = inkBox(current)
        // Jamo captured together in one cell already carry the user's ratio.
        if (!box || !info || learned === undefined || (info.sourceCellId && (info.sourceCellId === initialSource || (role === 'final' && info.sourceCellId === medialSource)))) return current
        const factor = Math.max(0.7, Math.min(1.4, learned * initialSize / Math.max(1, size(role, box, info.pen))))
        if (Math.abs(factor - 1) < 0.02) return current
        const resized = new opentype.Path()
        append(resized, factor)
        const next = inkBox(resized)
        if (next) shift(resized, (box.x1 + box.x2 - next.x1 - next.x2) / 2, (box.y1 + box.y2 - next.y1 - next.y2) / 2)
        return resized
      }
      medialPath = resize('medial', medialPath, medialInfo, ratios.medial, appendMedial)
      if (zones.final) finalPath = resize('final', finalPath, finalInfo, ratios.final, appendFinal)
    }
    const initialBox = inkBox(initialPath)
    const medialBox = inkBox(medialPath)
    const sameUpperCell = Boolean(initialSource && medialSource && initialSource === medialSource)
    if (initialBox && medialBox) {
      const medialAnchor = kind === 'mixed' ? mixedHorizontalBox(medialPath)! : medialBox
      if (!sameUpperCell) {
        if (kind === 'vertical') shift(initialPath, 0, (medialAnchor.y1 + medialAnchor.y2 - initialBox.y1 - initialBox.y2) / 2)
        else shift(initialPath, (medialAnchor.x1 + medialAnchor.x2 - initialBox.x1 - initialBox.x2) / 2, 0)
      }
      const adjustedInitial = inkBox(initialPath)!
      const char = String.fromCodePoint(codePoint)
      const pairKey = gapPair(initials[0], JUNGSEONG[vowelIndex][0], finalIndex > 0)
      const exactPlacement = gaps.initialMedialSyllables?.[char]
      const pairPlacement = gaps.initialMedialPairs?.[pairKey]
      const exact = exactPlacement?.advanceGap ?? gaps.syllables?.[char]
      const pair = pairPlacement?.advanceGap ?? gaps.pairs?.[pairKey]
      const learned = exact
        ?? pair
        ?? gaps.contexts?.[gapContext(kind, finalIndex > 0)] ?? gaps[kind] ?? DEFAULT_GAPS[kind]
      const placeMedial = (target: number) => {
        const anchor = kind === 'mixed' ? mixedHorizontalBox(medialPath)! : inkBox(medialPath)!
        if (kind === 'vertical') shift(medialPath, target - (anchor.x1 - adjustedInitial.x2), 0)
        else shift(medialPath, 0, (adjustedInitial.y1 - anchor.y2) - target)
      }
      const placement = exactPlacement ?? pairPlacement
      if (!sameUpperCell && placement) {
        if (kind === 'vertical') shift(medialPath, 0, placement.crossOffset)
        else shift(medialPath, placement.crossOffset, 0)
      }
      const policyRule = overlapRule('initial-medial', initials[0], JUNGSEONG[vowelIndex][0])
      const specific = exact !== undefined || pair !== undefined
      const rule = policyRule ?? (specific ? {
        id: 'learned-initial-medial', boundary: 'initial-medial' as const, notch: kind === 'vertical' ? 'RIGHT_NOTCH' as const : 'BOTTOM_CENTER_NOTCH' as const,
        first: [initials[0]], second: [JUNGSEONG[vowelIndex][0]], axis: kind === 'vertical' ? 'x' as const : 'y' as const,
        direction: kind === 'vertical' ? -1 as const : 1 as const, conditional: false,
      } : undefined)
      const target = Math.max(-minimumGap * 2, Math.min(300, learned))
      if ((specific && target < minimumGap) || (!specific && rule)) {
        placeMedial(minimumGap)
        const maximum = specific ? minimumGap - target : minimumGap + Math.min(500, kind === 'vertical' ? adjustedInitial.x2 - adjustedInitial.x1 : adjustedInitial.y2 - adjustedInitial.y1) * 0.45
        if (!rule || !safelyOverlap(initialPath, medialPath, rule, maximum, medialPath, !specific)) placeMedial(Math.max(minimumGap, Math.min(300, learned)))
      } else {
        placeMedial(Math.max(minimumGap, target))
      }
    }
    const finalBox = inkBox(finalPath)
    const adjustedInitial = inkBox(initialPath)
    const adjustedMedial = inkBox(medialPath)
    if (finalBox && (adjustedInitial || adjustedMedial)) {
      const upperBottom = Math.min(adjustedInitial?.y1 ?? Infinity, adjustedMedial?.y1 ?? Infinity)
      const char = String.fromCodePoint(codePoint)
      const medialChar = JUNGSEONG[vowelIndex][0]
      const finalChar = JONGSEONG[finalIndex][0]
      const finalPairKey = finalGapPair(medialChar, finalChar)
      const exactFinalPlacement = gaps.medialFinalSyllables?.[char]
      const pairFinalPlacement = gaps.medialFinalPairs?.[finalPairKey]
      const exactFinal = exactFinalPlacement?.advanceGap ?? gaps.finalSyllables?.[char]
      const pairFinal = pairFinalPlacement?.advanceGap ?? gaps.finalPairs?.[finalPairKey]
      const contextFinal = gaps.finalContexts?.[finalGapContext(kind, finalChar)]
      const specificTarget = exactFinal ?? pairFinal
      const target = Math.max(-minimumGap * 2, Math.min(300, specificTarget ?? contextFinal ?? gaps.final ?? DEFAULT_GAPS.final))
      const learnedFinalPlacement = exactFinalPlacement ?? pairFinalPlacement
      const preservesMedialFinalFrame = Boolean(finalSource && medialSource && finalSource === medialSource)
      if (!preservesMedialFinalFrame) {
        const left = Math.min(adjustedInitial?.x1 ?? Infinity, adjustedMedial?.x1 ?? Infinity)
        const right = Math.max(adjustedInitial?.x2 ?? -Infinity, adjustedMedial?.x2 ?? -Infinity)
        const targetCenter = learnedFinalPlacement && adjustedMedial
          ? (adjustedMedial.x1 + adjustedMedial.x2) / 2 + learnedFinalPlacement.crossOffset
          : (left + right) / 2
        shift(finalPath, targetCenter - (finalBox.x1 + finalBox.x2) / 2, 0)
      }
      const placeFinal = (nextTarget: number) => {
        const current = inkBox(finalPath)!
        shift(finalPath, 0, upperBottom - current.y2 - nextTarget)
      }
      const upperPath = new opentype.Path()
      upperPath.commands.push(...initialPath.commands, ...medialPath.commands)
      const policyRule = overlapRule('medial-final', medialChar, finalChar)
      const rule = policyRule ?? (specificTarget !== undefined ? {
        id: 'learned-medial-final', boundary: 'medial-final' as const, notch: 'TOP_CENTER_NOTCH' as const,
        first: [medialChar], second: [finalChar], axis: 'y' as const, direction: 1 as const, conditional: false,
      } : undefined)
      if ((specificTarget !== undefined && target < minimumGap) || (specificTarget === undefined && rule)) {
        placeFinal(minimumGap)
        const maximum = specificTarget !== undefined
          ? minimumGap - target
          : minimumGap + Math.min(500, finalBox.y2 - finalBox.y1) * 0.75
        if (!rule || !safelyOverlap(upperPath, finalPath, rule, maximum, medialPath, specificTarget === undefined)) placeFinal(Math.max(minimumGap, target))
      } else {
        placeFinal(Math.max(minimumGap, target))
      }
    }
    const path = new opentype.Path()
    path.commands.push(...initialPath.commands, ...medialPath.commands, ...finalPath.commands)
    const placedInitial = inkBox(initialPath)
    const placedMedial = inkBox(medialPath)
    const placedFinal = inkBox(finalPath)
    const upperGap = placedInitial && placedMedial
      ? kind === 'vertical'
        ? placedMedial.x1 - placedInitial.x2
        : placedInitial.y1 - (kind === 'mixed' ? mixedHorizontalBox(medialPath)!.y2 : placedMedial.y2)
      : Infinity
    const finalGap = placedFinal && (placedInitial || placedMedial)
      ? Math.min(placedInitial?.y1 ?? Infinity, placedMedial?.y1 ?? Infinity) - placedFinal.y2
      : Infinity
    return { path, initialPath, medialPath, finalPath, upperGap, finalGap }
  }

  const basePen = options?.penScale ?? 1
  const normalizationFor = (box: NonNullable<ReturnType<typeof inkBox>>) => {
    const height = box.y2 - box.y1
    const normalize = normalizationFactor(height, options?.targetHeight ?? 760, settings.hangulNormalization)
    const overflow = 950 / Math.max(box.x2 - box.x1, height)
    return Math.min(normalize, overflow)
  }
  let built = build(1, quantizePen(basePen))
  let box = inkBox(built.path)
  if (box) {
    const provisional = normalizationFor(box)
    // The syllable is about to be scaled as an outline. Compose it once more
    // with the inverse pen width so every syllable ends with the same stroke.
    if (Math.abs(provisional - 1) > 0.005) {
      const penScale = quantizePen(basePen / provisional)
      if (penScale !== quantizePen(basePen)) {
        built = build(1, penScale)
        box = inkBox(built.path)
      }
    }
  }
  const path = built.path
  if (box) {
    const factor = normalizationFor(box)
    if (Math.abs(factor - 1) > 0.005) {
      scalePath(path, factor)
      // Normalization scales silhouettes uniformly, but a positive optical gap
      // is an absolute pen-space constraint. Restore only gaps that were not
      // intentional overlap candidates before scaling.
      if (built.upperGap >= minimumGap - 1e-3) {
        const initialBox = inkBox(built.initialPath)
        const medialBox = inkBox(built.medialPath)
        if (initialBox && medialBox) {
          const currentGap = kind === 'vertical'
            ? medialBox.x1 - initialBox.x2
            : initialBox.y1 - (kind === 'mixed' ? mixedHorizontalBox(built.medialPath)!.y2 : medialBox.y2)
          const missing = Math.max(0, minimumGap - currentGap)
          if (kind === 'vertical') shift(built.medialPath, missing, 0)
          else shift(built.medialPath, 0, -missing)
        }
      }
      if (built.finalGap >= minimumGap - 1e-3) {
        const initialBox = inkBox(built.initialPath)
        const medialBox = inkBox(built.medialPath)
        const finalBox = inkBox(built.finalPath)
        if (finalBox && (initialBox || medialBox)) {
          const currentGap = Math.min(initialBox?.y1 ?? Infinity, medialBox?.y1 ?? Infinity) - finalBox.y2
          shift(built.finalPath, 0, -Math.max(0, minimumGap - currentGap))
        }
      }
      box = inkBox(path)
    }
  }
  if (box) {
    const dx = 500 - (box.x1 + box.x2) / 2
    const dy = box.y1 < 0 ? -box.y1 : box.y2 > 1000 ? 1000 - box.y2 : 0
    shift(path, dx, dy)
  }
  alignVerticalCenter(path, options?.targetCenter ?? 500, settings.verticalAlignment)
  return { path, parts: { initial: built.initialPath, medial: built.medialPath, final: built.finalPath } }
}
