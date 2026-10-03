import opentype from 'opentype.js'
import type { WritingSessionRecord } from '@/collection/records'
import { decomposeHangul, type VowelKind } from '@/font/hangul'
import { appendShape, normalizeRawStrokes } from '@/font/geometry/shape'
import { finalGapContext, finalGapPair, gapContext, gapPair, minimumGap, type GapProfile, type LearnedPlacement } from '@/font/layout/gap-profile'
import { medialSpace } from '@/font/layout/syllable-layout'
import { penDiameter, strokePolygon, type RawStroke } from '@/font/stroke/outline'
import { collect, completedHangulCells, trimmedMean } from './samples'

interface Bounds { left: number; right: number; top: number; bottom: number }
type Placement = Pick<LearnedPlacement, 'advanceGap' | 'crossOffset'>

/** Ink bounds of a jamo inside its cell, in canvas pixels (y down). */
function boundsFor(strokes: RawStroke[], cellX: number, cellY: number, cellSize: number, endpointStabilization: number): Bounds | null {
  const points = strokes.flatMap((stroke) => strokePolygon(
    stroke.points.map(([x, y]) => [stroke.x + x - cellX, stroke.y + y - cellY]),
    stroke.pressures,
    penDiameter(stroke.strokeWidth, cellSize),
    true,
    endpointStabilization,
  ))
  if (!points.length) return null
  return {
    left: Math.min(...points.map(([x]) => x)),
    right: Math.max(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)),
    bottom: Math.max(...points.map(([, y]) => y)),
  }
}

const mean = (values: number[], fallback: number) => trimmedMean(values) ?? fallback
const means = (groups: Map<string, number[]>) => Object.fromEntries([...groups].map(([key, values]) => [key, mean(values, minimumGap)]))
const placements = (groups: Map<string, Placement[]>): Record<string, LearnedPlacement> => Object.fromEntries([...groups].map(([key, values]) => [key, {
  advanceGap: mean(values.map((value) => value.advanceGap), minimumGap),
  crossOffset: mean(values.map((value) => value.crossOffset), 0),
  sampleCount: values.length,
}]))

/** Learn the free space the writer leaves between the jamo of a syllable. */
export function learnGaps(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1): GapProfile {
  const kinds: Record<VowelKind | 'final', number[]> = { vertical: [], horizontalUp: [], horizontalDown: [], mixed: [], final: [] }
  const contexts = new Map<string, number[]>()
  const finalContexts = new Map<string, number[]>()
  const initialMedialPairs = new Map<string, Placement[]>()
  const medialFinalPairs = new Map<string, Placement[]>()
  const initialMedialSyllables = new Map<string, Placement[]>()
  const medialFinalSyllables = new Map<string, Placement[]>()
  for (const { cell, session, assigned, cellX, cellY } of completedHangulCells(sessions)) {
    const boxes = assigned.map((group) => boundsFor(group, cellX, cellY, session.cellSize, endpointStabilization))
    if (boxes.some((box) => !box)) continue
    const [initial, medial, final] = boxes as [Bounds, Bounds, Bounds?]
    const { kind, chars } = decomposeHangul(cell.char.codePointAt(0)!)
    const scaledGap = (gap: number) => Math.max(-minimumGap * 2, Math.min(300, gap * 1000 / session.cellSize))

    // A compound vowel meets the initial with its horizontal part only.
    let medialAnchor = medial
    if (kind === 'mixed') {
      const local = assigned[1].map((stroke) => ({ ...stroke, x: stroke.x - cellX, y: stroke.y - cellY }))
      const shape = normalizeRawStrokes(local, session.cellSize, endpointStabilization)
      const path = new opentype.Path()
      if (shape) appendShape(path, shape, { x: 0, y: 0, width: session.cellSize, height: session.cellSize }, true, session.cellSize / 1000)
      const space = medialSpace(path)?.horizontal
      if (space) medialAnchor = { left: space.x1, right: space.x2, top: session.cellSize - space.y2, bottom: session.cellSize - space.y1 }
    }
    const upperGap = scaledGap(kind === 'vertical' ? medial.left - initial.right : medialAnchor.top - initial.bottom)
    const upper: Placement = {
      advanceGap: upperGap,
      crossOffset: kind === 'vertical'
        ? ((medial.top + medial.bottom) - (initial.top + initial.bottom)) * 500 / session.cellSize
        : ((medialAnchor.left + medialAnchor.right) - (initial.left + initial.right)) * 500 / session.cellSize,
    }
    kinds[kind].push(upperGap)
    collect(contexts, gapContext(kind, Boolean(final)), upperGap)
    collect(initialMedialPairs, gapPair(chars.initial, chars.medial, Boolean(final)), upper)
    collect(initialMedialSyllables, cell.char, upper)
    if (!final) continue

    const finalGap = scaledGap(final.top - Math.max(initial.bottom, medialAnchor.bottom))
    const lower: Placement = {
      advanceGap: finalGap,
      crossOffset: ((final.left + final.right) - (kind === 'mixed'
        ? medial.left + medial.right
        : Math.min(initial.left, medial.left) + Math.max(initial.right, medial.right))) * 500 / session.cellSize,
    }
    kinds.final.push(finalGap)
    collect(finalContexts, finalGapContext(kind, chars.final), finalGap)
    collect(medialFinalPairs, finalGapPair(chars.medial, chars.final), lower)
    collect(medialFinalSyllables, cell.char, lower)
  }
  return {
    vertical: mean(kinds.vertical, minimumGap),
    horizontalUp: mean(kinds.horizontalUp, minimumGap),
    horizontalDown: mean(kinds.horizontalDown, minimumGap),
    mixed: mean(kinds.mixed, minimumGap),
    final: mean(kinds.final, minimumGap),
    contexts: means(contexts),
    finalContexts: means(finalContexts),
    initialMedialPairs: placements(initialMedialPairs),
    medialFinalPairs: placements(medialFinalPairs),
    initialMedialSyllables: placements(initialMedialSyllables),
    medialFinalSyllables: placements(medialFinalSyllables),
  }
}
