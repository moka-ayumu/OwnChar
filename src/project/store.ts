import { Store } from '@tanstack/react-store'
import { keepIfSame, selectDrawings } from '@/collection/drawing-selection'
import { sessionCaptures, WRITING_EXERCISES, type GuideMode } from '@/collection/exercises'
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records'
import type { StoredCellGuide } from '@/font/guides'
import { DEFAULT_COMPOSITION_SETTINGS, type CompositionSettings } from '@/font/settings'
import { DEFAULT_GLYPH_OVERRIDE, type FontMetadata, type GlyphOverride } from '@/generation/request'
import { SCHEMA_VERSION, type GenerationState, type OverrideCommand, type ProjectState } from './types'

const defaultMetadata: FontMetadata = {
  familyName: 'OwnChar Font',
  styleName: 'Regular',
  designer: '',
  version: '1.0',
}

const idleGeneration: GenerationState = { progress: 0, message: '', error: null }

const initialProjectState: ProjectState = {
  schemaVersion: SCHEMA_VERSION,
  hydrated: false,
  status: 'empty',
  currentExercise: 0,
  guideMode: 'blank',
  drawings: {},
  writingSessions: {},
  metadata: defaultMetadata,
  globalMetrics: { left: 0, right: 0, y: 0 },
  compositionSettings: DEFAULT_COMPOSITION_SETTINGS,
  glyphOverrides: {},
  history: { past: [], future: [] },
  generation: idleGeneration,
  generatedFont: null,
  fontDirty: false,
  sourceDirty: false,
  fontRevision: 0,
}

export const projectStore = new Store<ProjectState>(initialProjectState)

const sameFields = (a: object, b: object) => a === b || (Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => (b as Record<string, unknown>)[key] === value))

/** Whether the project still holds what its font was generated with. A value changed and changed back is not a change. */
function matchesGeneratedFont(state: ProjectState, made: NonNullable<ProjectState['generatedWith']>) {
  return !state.sourceDirty
    && sameFields(state.metadata, made.metadata) && sameFields(state.globalMetrics, made.globalMetrics) && sameFields(state.compositionSettings, made.compositionSettings)
    && (state.glyphOverrides === made.glyphOverrides || (Object.keys(state.glyphOverrides).length === Object.keys(made.glyphOverrides).length
      && Object.entries(state.glyphOverrides).every(([codePoint, override]) => made.glyphOverrides[Number(codePoint)] && sameFields(override, made.glyphOverrides[Number(codePoint)]))))
}

function update(updater: (state: ProjectState) => ProjectState) {
  projectStore.setState((state) => {
    const next = updater(state)
    if (next === state || !next.generatedWith || !next.generatedFont) return next
    const fontDirty = !matchesGeneratedFont(next, next.generatedWith)
    return fontDirty === next.fontDirty ? next : { ...next, fontDirty }
  })
}

/** Replaces the overrides of `codePoints` as one undoable step. */
function commitOverrides(state: ProjectState, codePoints: number[], next: (current: GlyphOverride | undefined) => GlyphOverride | undefined): ProjectState {
  const command: OverrideCommand = { codePoints, before: {}, after: {} }
  for (const codePoint of codePoints) {
    command.before[codePoint] = state.glyphOverrides[codePoint]
    command.after[codePoint] = next(state.glyphOverrides[codePoint])
  }
  return {
    ...state,
    glyphOverrides: withOverrides(state, command, 'after'),
    fontDirty: true,
    history: { past: [...state.history.past.slice(-49), command], future: [] },
  }
}

function withOverrides(state: ProjectState, command: OverrideCommand, side: 'before' | 'after') {
  const overrides = { ...state.glyphOverrides }
  for (const codePoint of command.codePoints) {
    const value = command[side][codePoint]
    if (value) overrides[codePoint] = value
    else delete overrides[codePoint]
  }
  return overrides
}

export const projectActions = {
  startProject() {
    update((state) => ({
      ...initialProjectState,
      hydrated: true,
      status: 'writing',
      metadata: state.status === 'empty' ? defaultMetadata : state.metadata,
    }))
  },

  restoreProject(project: ProjectState | null) {
    const saved = project?.schemaVersion === SCHEMA_VERSION ? project : {}
    update(() => ({ ...initialProjectState, ...saved, hydrated: true }))
  },

  /** Keep the guides a sentence shows; they are display state and do not change the font sources. */
  saveSessionGuides(exerciseId: string, guides: Record<number, StoredCellGuide>) {
    update((state) => {
      const session = state.writingSessions[exerciseId]
      if (!session) return state
      return { ...state, writingSessions: { ...state.writingSessions, [exerciseId]: { ...session, guides } } }
    })
  },

  /** Sets what the writing page shows of the jamo already collected. It does not change any drawing. */
  setGuideMode(guideMode: GuideMode) {
    update((state) => state.guideMode === guideMode ? state : { ...state, guideMode })
  },

  /**
   * Saves one sentence canvas with every drawing written in it, then picks for
   * each jamo the best drawing written for it in any sentence.
   */
  saveSentenceCapture(session: WritingSessionRecord, records: DrawingRecord[]) {
    update((state) => {
      const key = (record: DrawingRecord) => `${record.promptId}|${record.capture.cellIndex}|${record.capture.slotIndex}`
      const before = sessionCaptures(session.exerciseId, state.writingSessions[session.exerciseId], state.drawings)
      const previous = new Map(before.map((record) => [key(record), record]))
      const captures = records.map((record) => keepIfSame(previous.get(key(record)), record))
      // A session saved before captures were kept takes its drawings as its captures now, so a better one elsewhere cannot lose them.
      const writingSessions: Record<string, WritingSessionRecord> = Object.fromEntries(Object.entries(state.writingSessions).map(([id, saved]) => [id, saved.captures ? saved : { ...saved, captures: sessionCaptures(id, saved, state.drawings) }]))
      writingSessions[session.exerciseId] = { ...session, captures }
      const drawings = selectDrawings(writingSessions, state.drawings)
      let changed = (state.writingSessions[session.exerciseId]?.elements.length ?? 0) !== session.elements.length
        || Object.keys(state.drawings).length !== Object.keys(drawings).length
      for (const [promptId, record] of Object.entries(drawings)) {
        if (state.drawings[promptId]?.previewSvg !== record.previewSvg) changed = true
      }
      return {
        ...state,
        status: changed ? 'writing' : state.status,
        drawings,
        writingSessions,
        fontDirty: changed || state.fontDirty,
        sourceDirty: changed || state.sourceDirty,
      }
    })
  },

  showExercise(index: number) {
    const next = Math.max(0, Math.min(WRITING_EXERCISES.length - 1, index))
    update((state) => ({ ...state, currentExercise: next }))
  },

  startGeneration() {
    update((state) => ({
      ...state,
      status: 'generating',
      generation: { progress: 0, message: '글자 데이터를 준비하고 있어요', error: null },
    }))
  },

  updateGenerationProgress(progress: number, message: string) {
    update((state) => ({ ...state, generation: { progress, message, error: null } }))
  },

  /** `made` is what the request was built with: the project can have changed while the font was generated. */
  completeGeneration(buffer: ArrayBuffer, made: NonNullable<ProjectState['generatedWith']>) {
    update((state) => ({
      ...state,
      status: 'ready',
      generatedFont: buffer,
      generatedWith: made,
      fontDirty: false,
      sourceDirty: false,
      fontRevision: state.fontRevision + 1,
      generation: { progress: 100, message: '폰트가 완성됐어요', error: null },
    }))
  },

  failGeneration(message: string) {
    update((state) => ({
      ...state,
      status: 'error',
      generation: { ...state.generation, error: message, message: '폰트를 만들지 못했어요' },
    }))
  },

  cancelGeneration() {
    update((state) => ({ ...state, status: 'writing', generation: idleGeneration }))
  },

  updateFontMetadata(patch: Partial<FontMetadata>) {
    update((state) => ({ ...state, metadata: { ...state.metadata, ...patch }, fontDirty: true }))
  },

  updateGlobalMetrics(patch: Partial<ProjectState['globalMetrics']>) {
    update((state) => ({ ...state, globalMetrics: { ...state.globalMetrics, ...patch }, fontDirty: true }))
  },

  updateCompositionSettings(patch: Partial<CompositionSettings>) {
    const normalized = patch.endpointStabilization === undefined ? patch : {
      ...patch,
      endpointStabilization: Math.max(0, Math.min(1, patch.endpointStabilization)),
    }
    update((state) => ({
      ...state,
      compositionSettings: { ...state.compositionSettings, ...normalized },
      fontDirty: true,
    }))
  },

  clearGlyphTransformsForRecompose() {
    update((state) => ({
      ...state,
      glyphOverrides: {},
      history: { past: [], future: [] },
      fontDirty: true,
    }))
  },

  applyGlyphTransform(codePoints: number[], patch: Partial<GlyphOverride>) {
    update((state) => commitOverrides(state, codePoints, (current) => ({ ...(current ?? DEFAULT_GLYPH_OVERRIDE), ...patch })))
  },

  resetGlyphTransform(codePoints: number[]) {
    update((state) => commitOverrides(state, codePoints, () => undefined))
  },

  resetAllGlyphTransforms() {
    update((state) => {
      const codePoints = Object.keys(state.glyphOverrides).map(Number)
      return codePoints.length ? commitOverrides(state, codePoints, () => undefined) : state
    })
  },

  undo() {
    update((state) => {
      const command = state.history.past.at(-1)
      if (!command) return state
      return {
        ...state,
        glyphOverrides: withOverrides(state, command, 'before'),
        fontDirty: true,
        history: { past: state.history.past.slice(0, -1), future: [command, ...state.history.future] },
      }
    })
  },

  redo() {
    update((state) => {
      const command = state.history.future[0]
      if (!command) return state
      return {
        ...state,
        glyphOverrides: withOverrides(state, command, 'after'),
        fontDirty: true,
        history: { past: [...state.history.past, command], future: state.history.future.slice(1) },
      }
    })
  },
}
