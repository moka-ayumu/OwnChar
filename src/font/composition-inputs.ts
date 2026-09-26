import { CHARACTER_PROMPTS } from '@/lib/prompts'
import { WRITING_EXERCISES, type WritingCell, type WritingExercise } from '@/lib/writing-exercises'
import type { CompositionSettings, DrawingRecord, GenerationRequest, HangulRole, WritingSessionRecord } from '@/types/project'
import { learnGaps } from './gap-learning'
import { variantShapeKey } from './hangul'
import { learnHangulCenter, learnHangulHeight } from './hangul-height'
import { normalizeRawStrokes, normalizeStrokePaths, type NormalizedShape } from './path-geometry'
import { learnProportions } from './proportion-learning'
import type { RawStroke } from './stroke-outline'
import type { LockedSyllable } from './syllable-lock'

export type RequestDrawings = GenerationRequest['drawings']

export function cellId(exerciseId: string, cellIndex: number) {
  return `${exerciseId}:${cellIndex}`
}

/** Drawings in the worker format: strokes moved into their own cell's coordinates. */
export function toRequestDrawings(drawings: Record<string, DrawingRecord>, sessions: Record<string, WritingSessionRecord>): RequestDrawings {
  return Object.fromEntries(Object.entries(drawings).map(([promptId, drawing]) => [
    promptId,
    drawing.derivedFromPromptId && drawings[drawing.derivedFromPromptId]
      ? { sourcePromptId: drawing.derivedFromPromptId }
      : {
        paths: drawing.paths,
        elements: (drawing.elements as unknown as RawStroke[]).map((element) => {
          const capture = drawing.capture
          const session = capture ? sessions[capture.exerciseId] : undefined
          const size = session?.cellSize ?? 148
          const columns = session?.columns ?? 1
          const offsetX = capture ? (capture.cellIndex % columns) * size : 0
          const offsetY = capture ? Math.floor(capture.cellIndex / columns) * size : 0
          return { ...element, x: element.x - offsetX, y: element.y - offsetY }
        }),
        cellSize: drawing.capture ? sessions[drawing.capture.exerciseId]?.cellSize ?? 148 : undefined,
        sourceCellId: drawing.capture ? cellId(drawing.capture.exerciseId, drawing.capture.cellIndex) : undefined,
      },
  ]))
}

export function shapesFromRequestDrawings(drawings: RequestDrawings, settings: CompositionSettings) {
  const shapes = new Map<string, NormalizedShape>()
  for (const prompt of CHARACTER_PROMPTS) {
    const drawing = drawings[prompt.id]
    const source = drawing?.sourcePromptId ? drawings[drawing.sourcePromptId] ?? drawing : drawing
    const paths = source?.paths
    const raw = source?.elements?.filter((element) => Array.isArray(element.points) && element.points.length > 0) ?? []
    if (raw.length || paths?.length) {
      const key = prompt.variantRole === undefined ? prompt.char : variantShapeKey(prompt.variantRole, prompt.variantIndex!, prompt.char)
      const shape = raw.length
        ? normalizeRawStrokes(raw, source?.cellSize ?? 148, settings.endpointStabilization)
        : normalizeStrokePaths(paths!, source?.cellSize)
      shape.sourceCellId = source?.sourceCellId
      const derivedRole = drawing?.sourcePromptId?.split('-')[0]
      if (derivedRole === 'initial' || derivedRole === 'medial' || derivedRole === 'final') shape.sourceRole = derivedRole
      shapes.set(key, shape)
    }
  }
  return shapes
}

export function learnCompositionProfile(sessions: Record<string, WritingSessionRecord>, settings: CompositionSettings) {
  return {
    gaps: learnGaps(sessions, settings.endpointStabilization),
    proportions: learnProportions(sessions),
    hangulTargetHeight: learnHangulHeight(sessions, settings.endpointStabilization),
    hangulTargetCenter: learnHangulCenter(sessions, settings.endpointStabilization),
  }
}

/** Capture and guide slots of a cell, in initial → medial → final order. */
export function indexedSlotsForCell(cell: WritingCell) {
  const roleOrder: Record<string, number> = { initial: 0, medial: 1, final: 2 }
  return [
    ...cell.slots.map((slot, slotIndex) => ({ slot, slotIndex, guide: false })),
    ...(cell.guides ?? []).map((slot, guideIndex) => ({ slot, slotIndex: cell.slots.length + guideIndex, guide: true })),
  ].sort((left, right) => (roleOrder[left.slot.role ?? ''] ?? 3) - (roleOrder[right.slot.role ?? ''] ?? 3))
}

/** A slot is fixed when its jamo was already captured somewhere other than this slot. */
export function isFixedSlot(promptId: string, cellIndex: number, slotIndex: number, exercise: WritingExercise, drawings: Record<string, DrawingRecord>) {
  const record = drawings[promptId]
  if (!record) return false
  if (record.capture?.exerciseId !== exercise.id) return true
  return record.capture.cellIndex !== cellIndex || record.capture.slotIndex !== slotIndex
}

/** Syllable cells whose fixed guide jamo were completed by jamo written in the cell. */
export function findLockedSyllables(drawings: Record<string, DrawingRecord>): Record<string, LockedSyllable> {
  const locks = new Map<string, LockedSyllable & { updatedAt: number }>()
  for (const exercise of WRITING_EXERCISES) {
    exercise.cells.forEach((cell, cellIndex) => {
      const slots = indexedSlotsForCell(cell).filter(({ slot }) => slot.role)
      if (slots.length < 2) return
      const fixed = slots.filter(({ slot, slotIndex }) => isFixedSlot(slot.promptId, cellIndex, slotIndex, exercise, drawings))
      const written = slots.filter(({ slot, slotIndex }) => {
        const capture = drawings[slot.promptId]?.capture
        return capture?.exerciseId === exercise.id && capture.cellIndex === cellIndex && capture.slotIndex === slotIndex
      })
      if (!fixed.length || !written.length) return
      const updatedAt = Math.max(...written.map(({ slot }) => drawings[slot.promptId].updatedAt))
      const previous = locks.get(cell.char)
      if (previous && previous.updatedAt >= updatedAt) return
      locks.set(cell.char, {
        cellId: cellId(exercise.id, cellIndex),
        writtenRoles: written.map(({ slot }) => slot.role as HangulRole),
        updatedAt,
      })
    })
  }
  return Object.fromEntries([...locks].map(([char, { cellId: id, writtenRoles }]) => [char, { cellId: id, writtenRoles }]))
}

/** Everything the composer needs, computed from project state. */
export function buildGenerationInputs(drawings: Record<string, DrawingRecord>, sessions: Record<string, WritingSessionRecord>, settings: CompositionSettings) {
  return {
    drawings: toRequestDrawings(drawings, sessions),
    lockedSyllables: findLockedSyllables(drawings),
    ...learnCompositionProfile(sessions, settings),
  }
}
