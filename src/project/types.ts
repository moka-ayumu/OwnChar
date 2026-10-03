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
  /** The captured strokes of each prompt. */
  drawings: Record<string, DrawingRecord>
  /** Raw, replayable sentence-canvas input. Kept separately from composed glyph sources. */
  writingSessions: Record<string, WritingSessionRecord>
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
  /** The generated font no longer matches the project. */
  fontDirty: boolean
  /** Handwriting changed since the font was generated. */
  sourceDirty: boolean
  fontRevision: number
}
