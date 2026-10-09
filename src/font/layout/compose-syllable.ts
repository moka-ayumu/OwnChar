import opentype from 'opentype.js'
import { HANGUL_ROLES, type HangulRole } from '@/font/hangul'
import { pathOf, scalePath, translatePath, type Box } from '@/font/geometry/path-ops'
import type { NormalizedShape } from '@/font/geometry/shape'
import { alignVerticalCenter, DEFAULT_HANGUL_HEIGHT, normalizationFactor } from '@/font/metrics'
import type { CompositionSettings } from '@/font/settings'
import type { GapProfile } from './gap-profile'
import type { ProportionProfile } from './proportion-profile'
import { layoutSyllable, type LayoutGeometry } from './syllable-layout'

export interface HangulComposeOptions {
  placeholderRoles?: HangulRole[]
  gaps?: GapProfile
  proportions?: ProportionProfile
  targetHeight?: number
  targetSize?: number
  targetCenter?: number
  penScale?: number
}

export interface HangulParts {
  path: opentype.Path
  parts: Record<HangulRole, opentype.Path>
  /** Where each placeholder role was reserved; placeholders carry no ink. */
  placeholders: Partial<Record<HangulRole, Box>>
  geometry: LayoutGeometry
}

export function composeHangulPath(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options?: HangulComposeOptions) {
  return composeHangulParts(codePoint, shapes, settings, options).path
}

/** One syllable laid out, normalized to the target height and centred in the em box. */
export function composeHangulParts(codePoint: number, shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions = {}): HangulParts {
  const build = (penScale: number) => {
    const result = layoutSyllable({ codePoint, shapes, penScale, gaps: options.gaps, proportions: options.proportions,
      placeholder: new Set(options.placeholderRoles),
      scales: { initial: settings.singleInitialScale, medial: settings.vowelScale, final: settings.finalScale },
    })
    return { ...result, path: pathOf(Object.values(result.parts).flatMap((part) => part.commands)) }
  }
  const factorFor = (path: opentype.Path) => {
    if (!path.commands.length) return 1
    const box = path.getBoundingBox()
    const width = box.x2 - box.x1; const height = box.y2 - box.y1
    const targetHeight = options.targetHeight ?? DEFAULT_HANGUL_HEIGHT
    // A flat syllable evened to the target height alone grows wide: its ink area holds it back.
    return Math.min(
      normalizationFactor(height, targetHeight, settings.hangulNormalization),
      normalizationFactor(Math.sqrt(width * height), options.targetSize ?? targetHeight, settings.hangulNormalization),
      950 / Math.max(1, width, height),
    )
  }
  const basePen = options.penScale ?? 1
  let built = build(basePen)
  // Re-outline in the final pen space; only similarity transforms reach the ink.
  let factor = factorFor(built.path)
  for (let iteration = 0; iteration < 2 && Math.abs(factor - 1) > 0.005; iteration += 1) {
    built = build(Math.round(basePen / factor * 200) / 200)
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
