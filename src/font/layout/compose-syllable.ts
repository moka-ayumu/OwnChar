import opentype from 'opentype.js'
import { decomposeHangul, HANGUL_BASE, HANGUL_COUNT, HANGUL_ROLES, type HangulRole } from '@/font/hangul'
import { pathOf, scalePath, translatePath, type Box } from '@/font/geometry/path-ops'
import type { NormalizedShape } from '@/font/geometry/shape'
import { alignVerticalCenter, DEFAULT_HANGUL_HEIGHT, normalizationFactor } from '@/font/metrics'
import type { CompositionSettings } from '@/font/settings'
import type { GapProfile } from './gap-profile'
import { proportionContext, type ProportionProfile } from './proportion-profile'
import { layoutSizes, layoutSyllable, type LayoutGeometry, type SizeTargets, type SyllableLayoutInput } from './syllable-layout'

export interface HangulComposeOptions {
  placeholderRoles?: HangulRole[]
  gaps?: GapProfile
  proportions?: ProportionProfile
  targetHeight?: number
  targetSize?: number
  targetCenter?: number
  penScale?: number
  /** Smallest factor the syllable may be scaled by toward the target size. */
  normalizeMinimum?: number
  /** Extra factor on the normalized syllable. The pen is rebuilt for it, so strokes keep their width. */
  scale?: number
  /** Without them the size dials of the settings do nothing. */
  sizeTargets?: SizeTargets
}

export interface HangulParts {
  path: opentype.Path
  parts: Record<HangulRole, opentype.Path>
  /** Where each placeholder role was reserved; placeholders carry no ink. */
  placeholders: Partial<Record<HangulRole, Box>>
  geometry: LayoutGeometry
}

function layoutInput(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions, penScale: number): SyllableLayoutInput {
  return { codePoint, shapes, penScale, gaps: options.gaps, proportions: options.proportions,
    targetAspect: options.targetHeight && options.targetSize ? (options.targetSize / options.targetHeight) ** 2 : undefined,
    placeholder: new Set(options.placeholderRoles),
    scales: { initial: settings.singleInitialScale, medial: settings.vowelScale, final: settings.finalScale },
  }
}

/** Syllables measured for each layout by `learnSizeTargets`. */
const TARGET_SAMPLE = 40

/** What the size dials draw toward: the mean jamo sizes and syllable width of each layout, over an even sample of its syllables. */
export function learnSizeTargets(shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions = {}): SizeTargets {
  const layouts = new Map<string, number[]>()
  for (let codePoint = HANGUL_BASE; codePoint < HANGUL_BASE + HANGUL_COUNT; codePoint += 1) {
    const { kind, finalIndex } = decomposeHangul(codePoint)
    const context = proportionContext(kind, finalIndex > 0)
    const codePoints = layouts.get(context)
    if (codePoints) codePoints.push(codePoint)
    else layouts.set(context, [codePoint])
  }
  const targets: SizeTargets = { roles: {}, widths: {} }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  for (const [context, codePoints] of layouts) {
    const measured = Array.from({ length: TARGET_SAMPLE }, (_, index) => {
      // Steps of the golden ratio visit every initial and vowel of the layout about equally often.
      const codePoint = codePoints[Math.floor(index * 0.6180339887 % 1 * codePoints.length)]
      return layoutSizes(decomposeHangul(codePoint).kind, layoutSyllable(layoutInput(codePoint, shapes, settings, options, 1)).parts)
    }).filter((sample) => sample.width > 0)
    if (!measured.length) continue
    targets.widths[context] = mean(measured.map((sample) => sample.width))
    targets.roles[context] = {}
    for (const role of HANGUL_ROLES) {
      const sizes = measured.flatMap((sample) => sample.sizes[role] ?? [])
      if (sizes.length) targets.roles[context][role] = mean(sizes)
    }
  }
  return targets
}

export function composeHangulPath(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options?: HangulComposeOptions) {
  return composeHangulParts(codePoint, shapes, settings, options).path
}

/** One syllable laid out, normalized to the target height and centred in the em box. */
export function composeHangulParts(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions = {}): HangulParts {
  const build = (penScale: number, draft = false) => {
    const result = layoutSyllable({ ...layoutInput(codePoint, shapes, settings, options, penScale),
      normalization: options.sizeTargets && { targets: options.sizeTargets, initial: settings.initialNormalization, medial: settings.medialNormalization, final: settings.finalNormalization, width: settings.widthNormalization, draft },
    })
    return { ...result, penScale, draft: draft && Boolean(options.sizeTargets), path: pathOf(Object.values(result.parts).flatMap((part) => part.commands)) }
  }
  const factorFor = (path: opentype.Path) => {
    if (!path.commands.length) return 1
    const box = path.getBoundingBox()
    const width = box.x2 - box.x1; const height = box.y2 - box.y1
    const targetHeight = options.targetHeight ?? DEFAULT_HANGUL_HEIGHT
    // A flat syllable evened to the target height alone grows wide: its ink area holds it back.
    return Math.min(
      Math.min(
        normalizationFactor(height, targetHeight, settings.hangulNormalization, options.normalizeMinimum),
        normalizationFactor(Math.sqrt(width * height), options.targetSize ?? targetHeight, settings.hangulNormalization, options.normalizeMinimum),
      ) * (options.scale ?? 1),
      950 / Math.max(1, width, height),
    )
  }
  const basePen = options.penScale ?? 1
  // The passes that only find the pen scale take the size dials as a draft; the last one outlines them.
  let built = build(basePen, true)
  // Re-outline in the final pen space; only similarity transforms reach the ink.
  let factor = factorFor(built.path)
  for (let iteration = 0; iteration < 2 && Math.abs(factor - 1) > 0.005; iteration += 1) {
    built = build(Math.round(basePen / factor * 200) / 200, iteration === 0)
    factor = factorFor(built.path)
  }
  if (built.draft) {
    built = build(built.penScale)
    factor = factorFor(built.path)
  }
  scalePath(built.path, factor, { x: 0, y: 0 })
  if (built.path.commands.length) {
    const box = built.path.getBoundingBox()
    translatePath(built.path, 500 - (box.x1 + box.x2) / 2, box.y1 < 0 ? -box.y1 : box.y2 > 1000 ? 1000 - box.y2 : 0)
  }
  alignVerticalCenter(built.path, options.targetCenter ?? 500, settings.verticalAlignment)
  const placeholders: HangulParts['placeholders'] = {}
  for (const role of HANGUL_ROLES) {
    const part = built.parts[role]
    if (!part.commands.length) continue
    const b = part.getBoundingBox()
    const center = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }
    built.geometry.anchors[role] = center
    if (built.geometry.scales[role] !== undefined) built.geometry.scales[role]! *= factor
    // Available space follows the same final transform as its role.
    const zone = built.geometry.zones[role]!
    const width = (zone.x2 - zone.x1) * factor; const height = (zone.y2 - zone.y1) * factor
    built.geometry.zones[role] = { x1: center.x - width / 2, y1: center.y - height / 2, x2: center.x + width / 2, y2: center.y + height / 2 }
    if (options.placeholderRoles?.includes(role)) {
      placeholders[role] = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 }
      const hidden = new Set(part.commands)
      built.path.commands = built.path.commands.filter((command) => !hidden.has(command))
      built.parts[role] = new opentype.Path()
    }
  }
  return { path: built.path, parts: built.parts, placeholders, geometry: built.geometry }
}
