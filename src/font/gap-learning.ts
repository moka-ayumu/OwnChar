import { WRITING_EXERCISES } from '@/lib/writing-exercises'
import type { WritingSessionRecord } from '@/types/project'
import { STROKE_SIZE_FACTOR, REFERENCE_CELL_SIZE, strokePolygon, type RawStroke } from './stroke-outline'
import { finalGapContext, finalGapPair, gapContext, gapPair, minimumGap, type GapKind, type GapProfile, type LearnedPlacement } from './gap-profile'

export type { GapProfile } from './gap-profile'
export { DEFAULT_GAPS } from './gap-profile'

const minimum = minimumGap

interface Bounds { left: number; right: number; top: number; bottom: number }

function boundsFor(strokes: RawStroke[], cellX: number, cellY: number, cellSize: number, endpointStabilization: number): Bounds | null {
  const points = strokes.flatMap((stroke) => strokePolygon(
    stroke.points.map(([x, y]) => [stroke.x + x - cellX, stroke.y + y - cellY]),
    stroke.pressures,
    stroke.strokeWidth * STROKE_SIZE_FACTOR * cellSize / REFERENCE_CELL_SIZE,
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

function average(values: number[], fallback: number) {
  if (!values.length) return fallback
  const sorted = [...values].sort((a, b) => a - b)
  const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0
  const retained = sorted.slice(trim, sorted.length - trim)
  return retained.reduce((sum, value) => sum + value, 0) / retained.length
}

function placement(values: Array<{ advanceGap: number; crossOffset: number }>, fallback: number): LearnedPlacement {
  return {
    advanceGap: average(values.map((value) => value.advanceGap), fallback),
    crossOffset: average(values.map((value) => value.crossOffset), 0),
    sampleCount: values.length,
  }
}

export function learnGaps(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1): GapProfile {
  const samples: Record<GapKind | 'final', number[]> = { vertical: [], horizontalUp: [], horizontalDown: [], mixed: [], final: [] }
  const contexts = new Map<string, number[]>()
  const pairs = new Map<string, number[]>()
  const syllables = new Map<string, number[]>()
  const finalContexts = new Map<string, number[]>()
  const finalPairs = new Map<string, number[]>()
  const finalSyllables = new Map<string, number[]>()
  const initialMedialPairs = new Map<string, Array<{ advanceGap: number; crossOffset: number }>>()
  const medialFinalPairs = new Map<string, Array<{ advanceGap: number; crossOffset: number }>>()
  const initialMedialSyllables = new Map<string, Array<{ advanceGap: number; crossOffset: number }>>()
  const medialFinalSyllables = new Map<string, Array<{ advanceGap: number; crossOffset: number }>>()
  for (const exercise of WRITING_EXERCISES) {
    if (exercise.group !== 'hangul') continue
    const session = sessions[exercise.id]
    if (!session) continue
    const strokes = new Map((session.elements as unknown as RawStroke[]).filter((item) => !item.isDeleted).map((item) => [item.id, item]))
    exercise.cells.forEach((cell, cellIndex) => {
      if (cell.slots.length < 2) return
      const assigned = cell.slots.map((_, slotIndex) => session.assignments
        .filter((assignment) => assignment.cellIndex === cellIndex && assignment.slotIndex === slotIndex)
        .map((assignment) => strokes.get(assignment.elementId))
        .filter((stroke): stroke is RawStroke => Boolean(stroke)))
      // A partly written syllable must never teach spacing.
      if (assigned.some((group, index) => group.length < cell.slots[index].expectedStrokes)) return
      const cellX = (cellIndex % session.columns) * session.cellSize
      const cellY = Math.floor(cellIndex / session.columns) * session.cellSize
      const boxes = assigned.map((group) => boundsFor(group, cellX, cellY, session.cellSize, endpointStabilization))
      if (boxes.some((box) => !box)) return
      const initial = boxes[0]!
      const medial = boxes[1]!
      const offset = cell.char.codePointAt(0)! - 0xac00
      const vowel = Math.floor((offset % 588) / 28)
      const kind: GapKind = new Set([0, 1, 2, 3, 4, 5, 6, 7, 20]).has(vowel) ? 'vertical'
        : new Set([8, 12]).has(vowel) ? 'horizontalUp'
          : new Set([13, 17, 18]).has(vowel) ? 'horizontalDown' : 'mixed'
      const gap = kind === 'vertical' ? medial.left - initial.right : medial.top - initial.bottom
      const scaledGap = Math.max(-minimum * 2, Math.min(300, gap * 1000 / session.cellSize))
      samples[kind].push(scaledGap)
      const context = gapContext(kind, Boolean(boxes[2]))
      contexts.set(context, [...(contexts.get(context) ?? []), scaledGap])
      const pair = gapPair(cell.slots[0].char, cell.slots[1].char, Boolean(boxes[2]))
      pairs.set(pair, [...(pairs.get(pair) ?? []), scaledGap])
      syllables.set(cell.char, [...(syllables.get(cell.char) ?? []), scaledGap])
      const upperCrossOffset = kind === 'vertical'
        ? ((medial.top + medial.bottom) - (initial.top + initial.bottom)) * 500 / session.cellSize
        : ((medial.left + medial.right) - (initial.left + initial.right)) * 500 / session.cellSize
      const upperPlacement = { advanceGap: scaledGap, crossOffset: upperCrossOffset }
      initialMedialPairs.set(pair, [...(initialMedialPairs.get(pair) ?? []), upperPlacement])
      initialMedialSyllables.set(cell.char, [...(initialMedialSyllables.get(cell.char) ?? []), upperPlacement])
      if (boxes[2]) {
        const upperBottom = Math.max(initial.bottom, medial.bottom)
        const finalGap = boxes[2]!.top - upperBottom
        const scaledFinalGap = Math.max(-minimum * 2, Math.min(300, finalGap * 1000 / session.cellSize))
        const medialChar = cell.slots[1].char
        const finalChar = cell.slots[2].char
        samples.final.push(scaledFinalGap)
        finalContexts.set(finalGapContext(kind, finalChar), [...(finalContexts.get(finalGapContext(kind, finalChar)) ?? []), scaledFinalGap])
        finalPairs.set(finalGapPair(medialChar, finalChar), [...(finalPairs.get(finalGapPair(medialChar, finalChar)) ?? []), scaledFinalGap])
        finalSyllables.set(cell.char, [...(finalSyllables.get(cell.char) ?? []), scaledFinalGap])
        const finalPlacement = {
          advanceGap: scaledFinalGap,
          crossOffset: ((boxes[2]!.left + boxes[2]!.right) - (medial.left + medial.right)) * 500 / session.cellSize,
        }
        const finalPair = finalGapPair(medialChar, finalChar)
        medialFinalPairs.set(finalPair, [...(medialFinalPairs.get(finalPair) ?? []), finalPlacement])
        medialFinalSyllables.set(cell.char, [...(medialFinalSyllables.get(cell.char) ?? []), finalPlacement])
      }
    })
  }
  return {
    vertical: average(samples.vertical, minimum),
    horizontalUp: average(samples.horizontalUp, minimum),
    horizontalDown: average(samples.horizontalDown, minimum),
    mixed: average(samples.mixed, minimum),
    final: average(samples.final, minimum),
    contexts: Object.fromEntries([...contexts].map(([key, values]) => [key, average(values, minimum)])),
    pairs: Object.fromEntries([...pairs].map(([key, values]) => [key, average(values, minimum)])),
    syllables: Object.fromEntries([...syllables].map(([key, values]) => [key, average(values, minimum)])),
    finalContexts: Object.fromEntries([...finalContexts].map(([key, values]) => [key, average(values, minimum)])),
    finalPairs: Object.fromEntries([...finalPairs].map(([key, values]) => [key, average(values, minimum)])),
    finalSyllables: Object.fromEntries([...finalSyllables].map(([key, values]) => [key, average(values, minimum)])),
    initialMedialPairs: Object.fromEntries([...initialMedialPairs].map(([key, values]) => [key, placement(values, minimum)])),
    medialFinalPairs: Object.fromEntries([...medialFinalPairs].map(([key, values]) => [key, placement(values, minimum)])),
    initialMedialSyllables: Object.fromEntries([...initialMedialSyllables].map(([key, values]) => [key, placement(values, minimum)])),
    medialFinalSyllables: Object.fromEntries([...medialFinalSyllables].map(([key, values]) => [key, placement(values, minimum)])),
  }
}
