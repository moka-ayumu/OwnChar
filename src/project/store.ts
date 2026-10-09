import { Store } from '@tanstack/react-store'
import { WRITING_EXERCISES } from '@/collection/exercises'
import { basePromptId, promptRole } from '@/collection/prompts'
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

/** The stored drawing when `next` repeats it, so what did not change keeps its identity. */
function keepIfSame(previous: DrawingRecord | undefined, next: DrawingRecord) {
  if (!previous || previous.previewSvg !== next.previewSvg || previous.codePoint !== next.codePoint || previous.derivedFromPromptId !== next.derivedFromPromptId) return next
  const { exerciseId, cellIndex, slotIndex } = next.capture
  if (previous.capture.exerciseId !== exerciseId || previous.capture.cellIndex !== cellIndex || previous.capture.slotIndex !== slotIndex) return next
  if (previous.elements.length !== next.elements.length) return next
  const same = previous.elements.every((stroke, index) => stroke.id === next.elements[index].id && stroke.version === next.elements[index].version && Boolean(stroke.isDeleted) === Boolean(next.elements[index].isDeleted))
  return same ? previous : next
}

const idleGeneration: GenerationState = { progress: 0, message: '', error: null }

const initialProjectState: ProjectState = {
  schemaVersion: SCHEMA_VERSION,
  hydrated: false,
  status: 'empty',
  currentExercise: 0,
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

function update(updater: (state: ProjectState) => ProjectState) {
  projectStore.setState(updater)
}

/** How well a contextual jamo stands in for the standalone one: open-syllable forms first, finals last. */
function sourcePriority(promptId: string) {
  if (promptRole(promptId) === 'final') return 1
  return Number(promptId.split('-')[1]) === 0 ? 3 : 2
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

  /** Saves one sentence canvas and the drawings captured from it, replacing what that sentence captured before. */
  saveSentenceCapture(session: WritingSessionRecord, records: DrawingRecord[]) {
    update((state) => {
      const drawings = { ...state.drawings }
      // A contextual jamo also serves as the standalone consonant or vowel,
      // unless a better form of it is already in use.
      const derivedRecords = records.flatMap((record): DrawingRecord[] => {
        const role = promptRole(record.promptId)
        if (!role) return []
        const promptId = basePromptId(role === 'medial' ? 'vowel' : 'consonant', String.fromCodePoint(record.codePoint))
        const existingSource = drawings[promptId]?.derivedFromPromptId
        // A source from this sentence counts only while it is still written.
        const existingIsActive = existingSource !== undefined
          && (drawings[promptId].capture.exerciseId !== session.exerciseId || records.some((candidate) => candidate.promptId === existingSource))
        if (existingIsActive && sourcePriority(existingSource) > sourcePriority(record.promptId)) return []
        return [{ ...record, promptId, derivedFromPromptId: record.promptId }]
      })
      const allRecords = [...records, ...derivedRecords].map((record) => keepIfSame(drawings[record.promptId], record))
      const activePromptIds = new Set(allRecords.map((record) => record.promptId))
      for (const [promptId, record] of Object.entries(drawings)) {
        if (record.capture.exerciseId === session.exerciseId && !activePromptIds.has(promptId)) delete drawings[promptId]
      }
      let changed = (state.writingSessions[session.exerciseId]?.elements.length ?? 0) !== session.elements.length
      for (const record of allRecords) {
        if (drawings[record.promptId]?.previewSvg !== record.previewSvg) changed = true
        drawings[record.promptId] = record
      }
      return {
        ...state,
        status: changed ? 'writing' : state.status,
        drawings,
        writingSessions: { ...state.writingSessions, [session.exerciseId]: session },
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

  completeGeneration(buffer: ArrayBuffer) {
    update((state) => ({
      ...state,
      status: 'ready',
      generatedFont: buffer,
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
