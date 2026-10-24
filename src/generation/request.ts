import type { CustomGlyph } from '@/collection/custom-glyphs'
import type { GapProfile } from '@/font/layout/gap-profile'
import type { ProportionProfile } from '@/font/layout/proportion-profile'
import type { CompositionSettings } from '@/font/settings'
import type { RawStroke } from '@/font/stroke/outline'

export interface FontMetadata {
  familyName: string
  styleName: string
  designer: string
  version: string
}

/** A manual adjustment of one glyph, in font units and degrees. */
export interface GlyphOverride {
  left: number
  right: number
  y: number
  scale: number
  rotation: number
}

export const DEFAULT_GLYPH_OVERRIDE: GlyphOverride = { left: 0, right: 0, y: 0, scale: 1, rotation: 0 }

/** A drawing as the font worker reads it: strokes in their own cell, or a pointer to the drawing it copies. */
export type RequestDrawing =
  | { elements: RawStroke[]; cellSize: number; sourceCellId: string }
  | { sourcePromptId: string }

/** What the handwriting samples teach about spacing, proportion and size. */
export interface CompositionProfile {
  gaps: GapProfile
  proportions: ProportionProfile
  hangulTargetHeight: number
  /** Square root of the ink area of a syllable at the target height. */
  hangulTargetSize: number
  hangulTargetCenter: number
  /** Median height and size of the syllables as written, without the limits of the target. */
  hangulWrittenHeight?: number
  hangulWrittenSize?: number
}

export interface GenerationRequest extends CompositionProfile {
  type: 'compose-font'
  drawings: Record<string, RequestDrawing>
  metadata: FontMetadata
  overrides: Record<number, GlyphOverride>
  globalMetrics: { left: number; right: number; y: number }
  compositionSettings: CompositionSettings
  /** Glyphs the writer drew whole: they replace composed syllables, add characters, or stand for a run of characters as a ligature. */
  customGlyphs?: Record<string, CustomGlyph>
}

export type FontWorkerRequest = GenerationRequest | { type: 'cancel' }

export type GenerationEvent =
  /** `lanes` is the share of its own range each child worker has composed, in worker order. */
  | { type: 'progress'; stage: string; progress: number; message: string; lanes?: number[] }
  | { type: 'complete'; buffer: ArrayBuffer; glyphCount: number }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
