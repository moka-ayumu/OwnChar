import { REFERENCE_CELL_SIZE, STROKE_SIZE_FACTOR } from './stroke-outline'

export interface GapProfile {
  vertical: number
  horizontalUp: number
  horizontalDown: number
  mixed: number
  final: number
  contexts: Record<string, number>
  pairs: Record<string, number>
  syllables: Record<string, number>
  finalContexts: Record<string, number>
  finalPairs: Record<string, number>
  finalSyllables: Record<string, number>
  initialMedialPairs: Record<string, LearnedPlacement>
  medialFinalPairs: Record<string, LearnedPlacement>
  initialMedialSyllables: Record<string, LearnedPlacement>
  medialFinalSyllables: Record<string, LearnedPlacement>
}

export interface LearnedPlacement {
  advanceGap: number
  crossOffset: number
  sampleCount: number
}

export const minimumGap = STROKE_SIZE_FACTOR * 1000 / REFERENCE_CELL_SIZE * 1.5
export const DEFAULT_GAPS: GapProfile = {
  vertical: minimumGap,
  horizontalUp: minimumGap,
  horizontalDown: minimumGap,
  mixed: minimumGap,
  final: minimumGap,
  contexts: {},
  pairs: {},
  syllables: {},
  finalContexts: {},
  finalPairs: {},
  finalSyllables: {},
  initialMedialPairs: {},
  medialFinalPairs: {},
  initialMedialSyllables: {},
  medialFinalSyllables: {},
}

export type GapKind = 'vertical' | 'horizontalUp' | 'horizontalDown' | 'mixed'

export function gapContext(kind: GapKind, hasFinal: boolean) {
  return `${kind}:${hasFinal ? 'final' : 'open'}`
}

export function gapPair(initial: string, medial: string, hasFinal: boolean) {
  return `${initial}:${medial}:${hasFinal ? 'final' : 'open'}`
}

const compoundFinals = new Set([...'ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ'])

export function finalGapPair(medial: string, final: string) {
  return `${medial}:${final}`
}

export function finalGapContext(kind: GapKind, final: string) {
  return `${kind}:${compoundFinals.has(final) ? 'compound' : 'single'}`
}
