import opentype from 'opentype.js'
import { DEFAULT_COMPOSITION_SETTINGS, type CompositionSettings } from '@/types/project'
import { composeHangulPath } from './hangul'
import type { GapProfile } from './gap-profile'
import type { ProportionProfile } from './proportion-profile'
import type { NormalizedShape } from './path-geometry'
import { medianHeight } from './size-normalization'

export const VISUAL_HANGUL_HEIGHT = 800

const fallbackSyllables = ['가', '나', '다', '마', '바', '사', '세', '루', '요']

/** One project-level scale keeps the relative proportions of handwriting samples. */
export function visualCalibrationScale(shapes: Map<string, NormalizedShape>, settings: CompositionSettings, gaps: GapProfile, targetHeight: number, targetCenter: number, proportions?: ProportionProfile) {
  const samples = Object.keys(gaps.syllables ?? {})
  const characters = samples.length ? samples.slice(0, 48) : fallbackSyllables
  const referenceSettings = { ...settings, hangulNormalization: DEFAULT_COMPOSITION_SETTINGS.hangulNormalization }
  const heights = characters.map((char) => {
    const codePoint = char.codePointAt(0)!
    if (codePoint < 0xac00 || codePoint > 0xd7a3) return 0
    const path = composeHangulPath(codePoint, shapes, referenceSettings, { gaps, proportions, targetHeight, targetCenter })
    if (!path.commands.length) return 0
    const box = path.getBoundingBox()
    return box.y2 - box.y1
  }).filter((height) => height >= 200 && height <= 950)
  const observed = medianHeight(heights, targetHeight)
  return Math.max(0.85, Math.min(1.6, VISUAL_HANGUL_HEIGHT / observed))
}

/** The scale `calibrateGlyphPath` applies: `factor` unless the glyph would outgrow its limits. */
export function calibrationFactor(path: opentype.Path, factor: number, fixedWidth: boolean, maximumHeight = 950) {
  if (!path.commands.length) return factor
  const box = path.getBoundingBox()
  const height = box.y2 - box.y1
  const width = box.x2 - box.x1
  return Math.min(factor, maximumHeight / Math.max(1, height), (fixedWidth ? 900 : 950) / Math.max(1, width))
}

/**
 * Render a glyph whose pen is rebuilt at `penScale`, then calibrate it. When a
 * height or width limit reduces the calibration below `factor`, the glyph is
 * rendered again with a wider pen so every glyph ends with the same stroke.
 */
export function renderCalibratedGlyph(render: (penScale: number) => opentype.Path, factor: number, anchorY: number, targetAnchorY: number, fixedWidth: boolean, maximumHeight = 950) {
  let path = render(1)
  const safe = calibrationFactor(path, factor, fixedWidth, maximumHeight)
  if (path.commands.length && safe > 0 && Math.abs(factor / safe - 1) > 0.005) path = render(factor / safe)
  calibrateGlyphPath(path, factor, anchorY, targetAnchorY, fixedWidth, maximumHeight)
  return path
}

/** Scale the whole ink outline, preserving its stroke-to-letter ratio. */
export function calibrateGlyphPath(path: opentype.Path, factor: number, anchorY: number, targetAnchorY: number, fixedWidth: boolean, maximumHeight = 950) {
  if (!path.commands.length) return
  const safeFactor = calibrationFactor(path, factor, fixedWidth, maximumHeight)
  for (const command of path.commands as Array<Record<string, any>>) {
    for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (typeof command[x] === 'number') command[x] = 500 + (command[x] - 500) * safeFactor
      if (typeof command[y] === 'number') command[y] = targetAnchorY + (command[y] - anchorY) * safeFactor
    }
  }
  const adjusted = path.getBoundingBox()
  const dx = fixedWidth ? 500 - (adjusted.x1 + adjusted.x2) / 2 : 0
  const dy = adjusted.y1 < -100 ? -100 - adjusted.y1 : adjusted.y2 > 900 ? 900 - adjusted.y2 : 0
  if (dx || dy) {
    for (const command of path.commands as Array<Record<string, any>>) {
      for (const x of ['x', 'x1', 'x2']) if (typeof command[x] === 'number') command[x] += dx
      for (const y of ['y', 'y1', 'y2']) if (typeof command[y] === 'number') command[y] += dy
    }
  }
}

export function symbolCalibrationAnchor(char: string) {
  if (char === '.') return 70
  if (char === ',') return 140
  if (char === "'" || char === '"') return 780
  if (char === '_') return 55
  if ('+-=*/<>'.includes(char)) return 450
  if ('()[]'.includes(char)) return 80
  return 100
}

export function symbolMaximumHeight(char: string) {
  if (char === '.' || char === ',') return 140
  if (char === "'" || char === '"') return 160
  if ('+-=*/<>'.includes(char)) return 400
  if ('()[]'.includes(char)) return 760
  if ('!?'.includes(char)) return 760
  return 350
}
