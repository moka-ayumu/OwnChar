import { Store } from '@tanstack/react-store'
import { CHARACTER_PROMPTS } from '@/lib/prompts'
import { WRITING_EXERCISES } from '@/lib/writing-exercises'
import { DEFAULT_COMPOSITION_SETTINGS, DEFAULT_GLYPH_OVERRIDE } from '@/types/project'
import type {
  DrawingRecord,
  FontMetadata,
  GlyphOverride,
  OverrideCommand,
  ProjectState,
} from '@/types/project'

const defaultMetadata: FontMetadata = {
  familyName: 'OwnChar Font',
  styleName: 'Regular',
  designer: '',
  version: '1.0',
}

export const initialProjectState: ProjectState = {
  schemaVersion: 7,
  settingsVersion: 7,
  fontBuildVersion: 8,
  hydrated: false,
  status: 'empty',
  currentPrompt: 0,
  drawings: {},
  writingSessions: {},
  metadata: defaultMetadata,
  globalMetrics: { left: 0, right: 0, y: 0 },
  compositionSettings: DEFAULT_COMPOSITION_SETTINGS,
  glyphOverrides: {},
  history: { past: [], future: [] },
  generation: { stage: 'idle', progress: 0, message: '', error: null },
  generatedFont: null,
  fontDirty: false,
  sourceDirty: false,
  fontRevision: 0,
  lastSavedAt: null,
}

export const projectStore = new Store<ProjectState>(initialProjectState)

function update(updater: (state: ProjectState) => ProjectState) {
  projectStore.setState(updater)
}

function applyCommand(state: ProjectState, command: OverrideCommand, direction: 'before' | 'after') {
  const next = { ...state.glyphOverrides }
  for (const codePoint of command.codePoints) {
    const value = command[direction][codePoint]
    if (value) next[codePoint] = value
    else delete next[codePoint]
  }
  return next
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
    if (!project || project.schemaVersion !== 7) {
      update((state) => ({ ...state, hydrated: true }))
      return
    }
    const legacyComposition = project.compositionSettings as typeof project.compositionSettings & { standaloneInitialMaxHeight?: number }
    const restoredComposition = {
      ...DEFAULT_COMPOSITION_SETTINGS,
      ...project.compositionSettings,
      standaloneJamoMaxHeight: legacyComposition.standaloneJamoMaxHeight ?? legacyComposition.standaloneInitialMaxHeight ?? DEFAULT_COMPOSITION_SETTINGS.standaloneJamoMaxHeight,
    }
    restoredComposition.endpointStabilization = Math.max(0, Math.min(1, restoredComposition.endpointStabilization))
    delete (restoredComposition as Record<string, unknown>).standaloneInitialMaxHeight
    // Numerals now share the height of ! and ?, so their own normalization is gone.
    delete (restoredComposition as Record<string, unknown>).numberNormalization
    const addedSettings = ['endpointStabilization', 'hangulNormalization', 'jamoNormalization', 'standaloneJamoMaxHeight', 'latinNormalization', 'widthMode'] as const
    const needsFontRegeneration = addedSettings.some((key) => !(key in (project.compositionSettings ?? {})))
    const legacySettings = project.settingsVersion !== 7
    const legacyDefaultSettings = !project.settingsVersion || project.settingsVersion < 4
    const legacyJamoSettings = !project.settingsVersion || project.settingsVersion < 2
    const legacyExerciseOrder = !('hangulNormalization' in (project.compositionSettings ?? {}))
    const restoredPrompt = legacyExerciseOrder && project.currentPrompt >= 3 ? project.currentPrompt + 1 : project.currentPrompt
    if (legacyJamoSettings && restoredComposition.jamoNormalization === 0) restoredComposition.jamoNormalization = 1
    if (legacyDefaultSettings && restoredComposition.jamoNormalization === 0.6) restoredComposition.jamoNormalization = 1
    if (legacyDefaultSettings && restoredComposition.standaloneJamoMaxHeight === 0.8) restoredComposition.standaloneJamoMaxHeight = 1
    // Earlier defaults shrank each captured jamo independently. Move only
    // unchanged defaults to the new frame-preserving neutral scale.
    if (restoredComposition.singleInitialScale === 0.8 || restoredComposition.singleInitialScale === 0.82) restoredComposition.singleInitialScale = 1
    if (restoredComposition.vowelScale === 0.92) restoredComposition.vowelScale = 1
    if (restoredComposition.finalScale === 0.9) restoredComposition.finalScale = 1
    update(() => ({
      ...initialProjectState,
      ...project,
      settingsVersion: 7,
      fontBuildVersion: 8,
      currentPrompt: legacyExerciseOrder ? Math.min(restoredPrompt, WRITING_EXERCISES.length - 3) : restoredPrompt,
      globalMetrics: { ...initialProjectState.globalMetrics, ...project.globalMetrics },
      compositionSettings: restoredComposition,
      writingSessions: project.writingSessions,
      sourceDirty: project.sourceDirty ?? false,
      fontDirty: project.fontDirty || needsFontRegeneration || legacySettings || project.fontBuildVersion !== 8,
      hydrated: true,
    }))
  },

  resetProject() {
    update(() => ({ ...initialProjectState, hydrated: true }))
  },

  saveDrawing(record: DrawingRecord) {
    update((state) => {
      const changed = state.drawings[record.promptId]?.previewSvg !== record.previewSvg
      return {
        ...state,
        status: changed ? 'writing' : state.status,
        drawings: { ...state.drawings, [record.promptId]: record },
        generatedFont: state.generatedFont,
        fontDirty: changed ? true : state.fontDirty,
        sourceDirty: changed ? true : state.sourceDirty,
      }
    })
  },

  saveSentenceCapture(session: import('@/types/project').WritingSessionRecord, records: DrawingRecord[]) {
    update((state) => {
      const drawings = { ...state.drawings }
      const derivedRecords = records.flatMap((record) => {
        const [role, variantText] = record.promptId.split('-')
        if (role !== 'initial' && role !== 'medial' && role !== 'final') return []
        const char = String.fromCodePoint(record.codePoint)
        const baseGroup = role === 'medial' ? 'vowel' : 'consonant'
        const promptId = `${baseGroup}-${record.codePoint}`
        const variant = Number(variantText)
        const priority = role === 'initial' && variant === 0 ? 3
          : role === 'medial' && variant === 0 ? 3
            : role === 'initial' || role === 'medial' ? 2 : 1
        const existing = drawings[promptId]
        const existingSource = existing?.derivedFromPromptId?.split('-') ?? []
        const existingVariant = Number(existingSource[1])
        const existingSourceIsActive = Boolean(existing?.derivedFromPromptId && (
          existing.capture?.exerciseId !== session.exerciseId || records.some((candidate) => candidate.promptId === existing.derivedFromPromptId)
        ))
        const existingPriority = !existing?.derivedFromPromptId && existing ? 4
          : !existingSourceIsActive ? 0
            : existingSource[0] === 'initial' && existingVariant === 0 ? 3
              : existingSource[0] === 'medial' && existingVariant === 0 ? 3
                : existingSource[0] === 'initial' || existingSource[0] === 'medial' ? 2 : 1
        if (existingPriority > priority) return []
        return [{ ...record, promptId, codePoint: char.codePointAt(0)!, derivedFromPromptId: record.promptId }]
      })
      const allRecords = [...records, ...derivedRecords]
      const activePromptIds = new Set(allRecords.map((record) => record.promptId))
      for (const [promptId, record] of Object.entries(drawings)) {
        if (record.capture?.exerciseId === session.exerciseId && !activePromptIds.has(promptId)) delete drawings[promptId]
      }
      let changed = false
      for (const record of allRecords) {
        if (drawings[record.promptId]?.previewSvg !== record.previewSvg) changed = true
        drawings[record.promptId] = record
      }
      const previous = state.writingSessions?.[session.exerciseId]
      if ((previous?.elements.length ?? 0) !== session.elements.length) changed = true
      return {
        ...state,
        status: changed ? 'writing' : state.status,
        drawings,
        writingSessions: { ...(state.writingSessions ?? {}), [session.exerciseId]: session },
        fontDirty: changed || state.fontDirty,
        sourceDirty: changed || state.sourceDirty,
      }
    })
  },

  clearDrawing(promptId: string) {
    update((state) => {
      const drawings = { ...state.drawings }
      delete drawings[promptId]
      return {
        ...state,
        status: 'writing',
        drawings,
        generatedFont: state.generatedFont,
        fontDirty: true,
        sourceDirty: true,
      }
    })
  },

  navigatePrompt(index: number, count = CHARACTER_PROMPTS.length) {
    const next = Math.max(0, Math.min(count - 1, index))
    update((state) => ({ ...state, currentPrompt: next }))
  },

  startGeneration() {
    update((state) => ({
      ...state,
      status: 'generating',
      generation: { stage: 'prepare', progress: 0, message: '글자 데이터를 준비하고 있어요', error: null },
    }))
  },

  updateGenerationProgress(stage: string, progress: number, message: string) {
    update((state) => ({ ...state, generation: { stage, progress, message, error: null } }))
  },

  completeGeneration(buffer: ArrayBuffer) {
    update((state) => ({
      ...state,
      status: 'ready',
      generatedFont: buffer,
      fontDirty: false,
      sourceDirty: false,
      fontRevision: state.fontRevision + 1,
      generation: { stage: 'complete', progress: 100, message: '폰트가 완성됐어요', error: null },
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
    update((state) => ({
      ...state,
      status: 'writing',
      generation: { stage: 'idle', progress: 0, message: '', error: null },
    }))
  },

  updateFontMetadata(patch: Partial<FontMetadata>) {
    update((state) => ({
      ...state,
      metadata: { ...state.metadata, ...patch },
      fontDirty: true,
    }))
  },

  updateGlobalMetrics(patch: Partial<ProjectState['globalMetrics']>) {
    update((state) => ({
      ...state,
      globalMetrics: { ...state.globalMetrics, ...patch },
      fontDirty: true,
    }))
  },

  updateCompositionSettings(patch: Partial<ProjectState['compositionSettings']>) {
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
    update((state) => {
      const before: OverrideCommand['before'] = {}
      const after: OverrideCommand['after'] = {}
      const glyphOverrides = { ...state.glyphOverrides }
      for (const codePoint of codePoints) {
        before[codePoint] = glyphOverrides[codePoint]
        const value = { ...(glyphOverrides[codePoint] ?? DEFAULT_GLYPH_OVERRIDE), ...patch }
        glyphOverrides[codePoint] = value
        after[codePoint] = value
      }
      const command: OverrideCommand = { codePoints, before, after }
      return {
        ...state,
        glyphOverrides,
        fontDirty: true,
        history: { past: [...state.history.past.slice(-49), command], future: [] },
      }
    })
  },

  resetGlyphTransform(codePoints: number[]) {
    update((state) => {
      const before: OverrideCommand['before'] = {}
      const after: OverrideCommand['after'] = {}
      const glyphOverrides = { ...state.glyphOverrides }
      for (const codePoint of codePoints) {
        before[codePoint] = glyphOverrides[codePoint]
        after[codePoint] = undefined
        delete glyphOverrides[codePoint]
      }
      const command: OverrideCommand = { codePoints, before, after }
      return {
        ...state,
        glyphOverrides,
        fontDirty: true,
        history: { past: [...state.history.past.slice(-49), command], future: [] },
      }
    })
  },

  resetAllGlyphTransforms() {
    update((state) => {
      const codePoints = Object.keys(state.glyphOverrides).map(Number)
      if (!codePoints.length) return state
      const before: OverrideCommand['before'] = {}
      const after: OverrideCommand['after'] = {}
      for (const codePoint of codePoints) {
        before[codePoint] = state.glyphOverrides[codePoint]
        after[codePoint] = undefined
      }
      const command: OverrideCommand = { codePoints, before, after }
      return {
        ...state,
        glyphOverrides: {},
        fontDirty: true,
        history: { past: [...state.history.past.slice(-49), command], future: [] },
      }
    })
  },

  undo() {
    update((state) => {
      const command = state.history.past.at(-1)
      if (!command) return state
      return {
        ...state,
        glyphOverrides: applyCommand(state, command, 'before'),
        fontDirty: true,
        history: {
          past: state.history.past.slice(0, -1),
          future: [command, ...state.history.future],
        },
      }
    })
  },

  redo() {
    update((state) => {
      const command = state.history.future[0]
      if (!command) return state
      return {
        ...state,
        glyphOverrides: applyCommand(state, command, 'after'),
        fontDirty: true,
        history: {
          past: [...state.history.past, command],
          future: state.history.future.slice(1),
        },
      }
    })
  },

  markSaved(savedAt: number) {
    update((state) => state.lastSavedAt === savedAt ? state : ({ ...state, lastSavedAt: savedAt }))
  },
}
