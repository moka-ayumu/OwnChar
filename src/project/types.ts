import type { CustomGlyph } from '@/collection/custom-glyphs'
import type { GuideMode } from '@/collection/exercises'
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records'
import type { CompositionSettings } from '@/font/settings'
import type { FontMetadata, GlyphOverride } from '@/generation/request'

/** Version of the saved project format. A project saved in any other format is not opened. */
export const SCHEMA_VERSION = 1

export type ProjectStatus = 'empty' | 'writing' | 'generating' | 'ready' | 'error'

/** One undoable change of glyph overrides. */
export interface OverrideCommand {
  codePoints: number[]
  before: Record<number, GlyphOverride | undefined>
  after: Record<number, GlyphOverride | undefined>
}

export interface GenerationState {
  progress: number
  message: string
  error: string | null
}

export interface ProjectState {
  schemaVersion: typeof SCHEMA_VERSION
  /** False until the saved project has been read. */
  hydrated: boolean
  status: ProjectStatus
  /** Index of the sentence shown on the writing page. */
  currentExercise: number
  /** What the writing page shows of the jamo already collected. */
  guideMode: GuideMode
  /** The captured strokes of each prompt: the best of the drawings written for it. */
  drawings: Record<string, DrawingRecord>
  /** Raw, replayable sentence-canvas input. Kept separately from composed glyph sources. */
  writingSessions: Record<string, WritingSessionRecord>
  /** Glyphs drawn whole, by the characters they stand for. */
  customGlyphs: Record<string, CustomGlyph>
  /** The writer has seen the guide to the glyphs drawn whole. */
  customGuideSeen: boolean
  metadata: FontMetadata
  globalMetrics: { left: number; right: number; y: number }
  compositionSettings: CompositionSettings
  glyphOverrides: Record<number, GlyphOverride>
  history: {
    past: OverrideCommand[]
    future: OverrideCommand[]
  }
  generation: GenerationState
  generatedFont: ArrayBuffer | null
  /** What the generated font was made with, besides the handwriting. Absent in a project whose font was generated before this was kept. */
  generatedWith?: Pick<ProjectState, 'metadata' | 'globalMetrics' | 'compositionSettings' | 'glyphOverrides'> & { customGlyphs?: Record<string, number> }
  /** The generated font no longer matches the project. */
  fontDirty: boolean
  /** Handwriting changed since the font was generated. */
  sourceDirty: boolean
  fontRevision: number
}
