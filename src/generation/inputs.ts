import { CHARACTER_PROMPTS, promptRole } from '@/collection/prompts'
import { cellId, cellOrigin, type DrawingRecord, type WritingSessionRecord } from '@/collection/records'
import { COMPOUND_FINALS } from '@/font/hangul'
import { combineShapesSideBySide, normalizeRawStrokes, type NormalizedShape } from '@/font/geometry/shape'
import { sourceKey } from '@/font/layout/source-selection'
import type { CompositionSettings } from '@/font/settings'
import { learnGaps } from './learning/gaps'
import { learnHangulMetrics } from './learning/metrics'
import { learnProportions } from './learning/proportions'
import type { CompositionProfile, RequestDrawing } from './request'

/** Widest a standalone compound final built from parts may be, as width / height. */
const STANDALONE_COMPOUND_ASPECT = 1.5

type SourceDrawing = Extract<RequestDrawing, { elements: unknown }>

const sourceDrawingCache = new WeakMap<DrawingRecord, { columns: number; cellSize: number; value: SourceDrawing }>()
const shapeCache = new WeakMap<SourceDrawing['elements'], Map<string, NormalizedShape | undefined>>()

/** Drawings in the worker format: strokes moved into their own cell's coordinates. */
export function toRequestDrawings(drawings: Record<string, DrawingRecord>, sessions: Record<string, WritingSessionRecord>): Record<string, RequestDrawing> {
  return Object.fromEntries(Object.entries(drawings).map(([promptId, drawing]): [string, RequestDrawing] => {
    if (drawing.derivedFromPromptId && drawings[drawing.derivedFromPromptId]) return [promptId, { sourcePromptId: drawing.derivedFromPromptId }]
    const { exerciseId, cellIndex } = drawing.capture
    const session = sessions[exerciseId]
    const cached = sourceDrawingCache.get(drawing)
    if (cached && cached.columns === session.columns && cached.cellSize === session.cellSize) return [promptId, cached.value]
    const origin = cellOrigin(cellIndex, session.columns, session.cellSize)
    const value: SourceDrawing = {
      elements: drawing.elements.map((element) => ({ ...element, x: element.x - origin.x, y: element.y - origin.y })),
      cellSize: session.cellSize,
      sourceCellId: cellId(exerciseId, cellIndex),
    }
    sourceDrawingCache.set(drawing, { columns: session.columns, cellSize: session.cellSize, value })
    return [promptId, value]
  }))
}

/** A copy of the shape of one source drawing, kept while the drawing and the stroke conditioning stay the same. Each copy has its own centerlines, because the pen outlines are cached by centerline. */
function normalizedSource(source: SourceDrawing, endpointStabilization: number) {
  let byKey = shapeCache.get(source.elements)
  if (!byKey) shapeCache.set(source.elements, byKey = new Map())
  const key = `${source.cellSize}|${endpointStabilization}`
  if (!byKey.has(key)) byKey.set(key, normalizeRawStrokes(source.elements, source.cellSize, endpointStabilization))
  const shape = byKey.get(key)
  return shape && { ...shape, frame: { ...shape.frame }, strokes: shape.strokes.map((stroke) => ({ ...stroke, centerline: { ...stroke.centerline } })) }
}

/** Every captured jamo and character as a placeable shape, keyed by character or by contextual source key. */
export function shapesFromRequestDrawings(drawings: Record<string, RequestDrawing>, settings: CompositionSettings) {
  const shapes = new Map<string, NormalizedShape>()
  for (const prompt of CHARACTER_PROMPTS) {
    const drawing = drawings[prompt.id]
    if (!drawing) continue
    const source = 'sourcePromptId' in drawing ? drawings[drawing.sourcePromptId] : drawing
    if (!source || !('elements' in source)) continue
    const shape = normalizedSource(source, settings.endpointStabilization)
    if (!shape) continue
    shape.sourceCellId = source.sourceCellId
    if ('sourcePromptId' in drawing) shape.sourceRole = promptRole(drawing.sourcePromptId)
    shapes.set(prompt.variantRole === undefined ? prompt.char : sourceKey(prompt.variantRole, prompt.variantIndex!, prompt.char), shape)
  }
  // Unwritten compound finals are composed from their captured single finals,
  // both in syllables and as standalone jamo.
  for (const [compound, [first, second]] of Object.entries(COMPOUND_FINALS)) {
    const key = sourceKey('final', 0, compound)
    if (shapes.has(key)) continue
    const left = shapes.get(sourceKey('final', 0, first))
    const right = shapes.get(sourceKey('final', 0, second))
    if (!left || !right) continue
    const combined = combineShapesSideBySide(left, right)
    combined.sourceRole = 'final'
    shapes.set(key, combined)
    // On its own there is no upper body to measure against, so a wide part is
    // narrowed toward the proportions of a written compound.
    if (!shapes.has(compound)) shapes.set(compound, { ...combineShapesSideBySide(left, right, STANDALONE_COMPOUND_ASPECT), sourceRole: 'final' })
  }
  return shapes
}

export function learnCompositionProfile(sessions: Record<string, WritingSessionRecord>, settings: CompositionSettings): CompositionProfile {
  return {
    gaps: learnGaps(sessions, settings.endpointStabilization),
    proportions: learnProportions(sessions),
    ...learnHangulMetrics(sessions, settings.endpointStabilization),
  }
}

/** Everything the composer needs, computed from project state. */
export function buildGenerationInputs(drawings: Record<string, DrawingRecord>, sessions: Record<string, WritingSessionRecord>, settings: CompositionSettings) {
  return {
    drawings: toRequestDrawings(drawings, sessions),
    ...learnCompositionProfile(sessions, settings),
  }
}
