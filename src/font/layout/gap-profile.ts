import type { VowelKind } from '@/font/hangul'
import { COMPOUND_FINALS } from '@/font/hangul'
import { REFERENCE_CELL_SIZE, STROKE_SIZE_FACTOR } from '@/font/stroke/outline'

/** Where the writer puts one jamo relative to the one before it, in font units. */
export interface LearnedPlacement {
  /** Free space between the two along the direction they follow each other. */
  advanceGap: number
  /** Offset of their centres across that direction. */
  crossOffset: number
  sampleCount: number
}

/**
 * Learned spacing, from the most general to the most specific sample: a gap
 * per vowel kind, per context, per vowel, and a placement per jamo pair and
 * per syllable.
 */
export interface GapProfile {
  vertical: number
  horizontalUp: number
  horizontalDown: number
  mixed: number
  final: number
  contexts: Record<string, number>
  /** Vowels of one kind differ in shape: a bare bar is kept further from the initial than a bar with a stem. */
  medialContexts: Record<string, number>
  finalContexts: Record<string, number>
  initialMedialPairs: Record<string, LearnedPlacement>
  medialFinalPairs: Record<string, LearnedPlacement>
  initialMedialSyllables: Record<string, LearnedPlacement>
  medialFinalSyllables: Record<string, LearnedPlacement>
}

export const minimumGap = STROKE_SIZE_FACTOR * 1000 / REFERENCE_CELL_SIZE * 1.5

export const DEFAULT_GAPS: GapProfile = {
  vertical: minimumGap,
  horizontalUp: minimumGap,
  horizontalDown: minimumGap,
  mixed: minimumGap,
  final: minimumGap,
  contexts: {},
  medialContexts: {},
  finalContexts: {},
  initialMedialPairs: {},
  medialFinalPairs: {},
  initialMedialSyllables: {},
  medialFinalSyllables: {},
}

export function gapContext(kind: VowelKind, hasFinal: boolean) {
  return `${kind}:${hasFinal ? 'final' : 'open'}`
}

export function medialGapContext(medial: string, hasFinal: boolean) {
  return `${medial}:${hasFinal ? 'final' : 'open'}`
}

export function gapPair(initial: string, medial: string, hasFinal: boolean) {
  return `${initial}:${medial}:${hasFinal ? 'final' : 'open'}`
}

export function finalGapPair(medial: string, final: string) {
  return `${medial}:${final}`
}

export function finalGapContext(kind: VowelKind, final: string) {
  return `${kind}:${final in COMPOUND_FINALS ? 'compound' : 'single'}`
}
