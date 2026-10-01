import type { RawStroke } from '@/font/stroke-outline'

export type ProjectStatus = 'empty' | 'writing' | 'generating' | 'ready' | 'error'

export type PromptGroup = 'consonant' | 'vowel' | 'uppercase' | 'lowercase' | 'number' | 'symbol' | 'initialVariant' | 'medialVariant' | 'finalVariant'
export type HangulRole = 'initial' | 'medial' | 'final'

export interface CharacterPrompt {
  id: string
  char: string
  codePoint: number
  group: PromptGroup
  order: number
  variantRole?: HangulRole
  variantIndex?: number
  contextLabel?: string
  example?: string
}

export interface StrokePath {
  d: string
  x: number
  y: number
  width: number
  height: number
}

export interface DrawingRecord {
  promptId: string
  codePoint: number
  elements: readonly Record<string, unknown>[]
  paths: StrokePath[]
  previewSvg: string
  updatedAt: number
  capture?: {
    exerciseId: string
    cellIndex: number
    slotIndex: number
  }
  derivedFromPromptId?: string
}

export interface StrokeAssignment {
  elementId: string
  cellIndex: number
  slotIndex: number
  promptId: string
}

export interface WritingSessionRecord {
  exerciseId: string
  text: string
  elements: readonly Record<string, unknown>[]
  assignments: StrokeAssignment[]
  boundaries: Record<number, JamoBoundary[]>
  cellSize: number
  columns: number
  updatedAt: number
  /** Fixed guide jamo of each written cell, kept exactly where they were shown. */
  guides?: Record<number, StoredCellGuide>
}

/** An ink box in font units (1000 per cell, y up). */
export interface GuideBox { x1: number; y1: number; x2: number; y2: number }

export interface GuideCommand { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

export interface StoredGuideRole {
  /** The source jamo drawing the outline was made from. */
  source: string
  box: GuideBox
  commands: GuideCommand[]
}

export interface StoredCellGuide {
  /** Revision 2 uses neutral placeholders and one 80% canvas transform. */
  sizingVersion?: 1 | 2
  roles: Partial<Record<HangulRole, StoredGuideRole>>
  /** Where the roles still to be written were reserved. */
  placeholders: Partial<Record<HangulRole, GuideBox>>
  /** Room around each placeholder where the jamo may be written without touching a guide. */
  bands?: Partial<Record<HangulRole, GuideBox>>
}

export interface JamoBoundary {
  slotIndex: number
  promptId: string
  afterElementId: string
  confirmedAt: number
}

export interface FontMetadata {
  familyName: string
  styleName: string
  designer: string
  version: string
}

export interface GlyphOverride {
  left: number
  right: number
  y: number
  scale: number
  rotation: number
}

export interface CompositionSettings {
  endpointStabilization: number
  singleInitialScale: number
  vowelScale: number
  finalScale: number
  hangulNormalization: number
  jamoNormalization: number
  standaloneJamoMaxHeight: number
  latinNormalization: number
  verticalAlignment: number
  widthMode: 'proportional' | 'fixed'
}

export interface OverrideCommand {
  codePoints: number[]
  before: Record<number, GlyphOverride | undefined>
  after: Record<number, GlyphOverride | undefined>
}

export interface GenerationState {
  stage: string
  progress: number
  message: string
  error: string | null
}

export interface ProjectState {
  schemaVersion: 8
  settingsVersion: 8
  fontBuildVersion: 12
  hydrated: boolean
  status: ProjectStatus
  currentPrompt: number
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
  fontDirty: boolean
  sourceDirty: boolean
  fontRevision: number
  lastSavedAt: number | null
}

export interface GenerationRequest {
  type: 'compose-font'
  drawings: Record<string, { paths?: StrokePath[]; elements?: RawStroke[]; cellSize?: number; sourcePromptId?: string; sourceCellId?: string }>
  metadata: FontMetadata
  overrides: Record<number, GlyphOverride>
  globalMetrics: { left: number; right: number; y: number }
  compositionSettings: CompositionSettings
  gaps: import('@/font/gap-profile').GapProfile
  proportions: import('@/font/proportion-profile').ProportionProfile
  hangulTargetHeight: number
  hangulTargetCenter: number
  unitsPerEm: 1000
}

export interface CancelGenerationRequest {
  type: 'cancel'
}

export type FontWorkerRequest = GenerationRequest | CancelGenerationRequest

export type GenerationEvent =
  | { type: 'progress'; stage: string; progress: number; message: string }
  | { type: 'complete'; buffer: ArrayBuffer; glyphCount: number }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export const DEFAULT_GLYPH_OVERRIDE: GlyphOverride = {
  left: 0,
  right: 0,
  y: 0,
  scale: 1,
  rotation: 0,
}

export const DEFAULT_COMPOSITION_SETTINGS: CompositionSettings = {
  endpointStabilization: 1,
  singleInitialScale: 1,
  vowelScale: 1,
  finalScale: 1,
  hangulNormalization: 0.8,
  jamoNormalization: 1,
  standaloneJamoMaxHeight: 1,
  latinNormalization: 0,
  verticalAlignment: 0.8,
  widthMode: 'proportional',
}
