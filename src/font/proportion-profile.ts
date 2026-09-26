import type { HangulRole } from '@/types/project'
import type { GapKind } from './gap-profile'

/** Jamo sizes relative to the initial consonant of the same syllable. */
export interface RoleRatios {
  medial?: number
  final?: number
  sampleCount: number
}

export interface ProportionProfile {
  contexts: Record<string, RoleRatios>
  pairs: Record<string, RoleRatios>
  syllables: Record<string, RoleRatios>
}

export const EMPTY_PROPORTIONS: ProportionProfile = { contexts: {}, pairs: {}, syllables: {} }

export function proportionContext(kind: GapKind, hasFinal: boolean) {
  return `${kind}:${hasFinal ? 'final' : 'open'}`
}

export function proportionPair(initial: string, medial: string, final?: string) {
  return `${initial}:${medial}:${final ?? ''}`
}

/**
 * One size number per jamo, measured on its pen centerline (ink bounds minus
 * the pen diameter) so the pen does not dominate thin jamo such as ㅡ.
 * Consonants use their area; a vowel uses the length of its main stroke.
 */
export function jamoSize(role: HangulRole, kind: GapKind, width: number, height: number) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  if (role !== 'medial') return Math.sqrt(w * h)
  if (kind === 'vertical') return h
  if (kind === 'mixed') return Math.max(w, h)
  return w
}

export function learnedRatios(profile: ProportionProfile | undefined, char: string, pair: string, context: string): RoleRatios | undefined {
  if (!profile) return undefined
  return profile.syllables[char] ?? profile.pairs[pair] ?? profile.contexts[context]
}
