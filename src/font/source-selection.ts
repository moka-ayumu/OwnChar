import type { HangulRole } from '@/types/project'

export type SourceMatch = 'exact' | 'same-role' | 'base' | 'cross-role'

export function sourceKey(role: HangulRole, variant: number, char: string) {
  return `${role}:${variant}:${char}`
}

function initialFamily(variant: number) {
  if (variant === 0 || variant === 5) return 'vertical'
  if (variant === 1) return 'upward'
  if (variant === 2) return 'downward'
  if (variant === 6) return 'horizontal'
  return 'mixed'
}

function candidateScore(role: HangulRole, requested: number, candidate: number) {
  if (role !== 'initial') return Math.abs(requested - candidate)
  const sameFinal = (requested >= 5) === (candidate >= 5)
  const requestedFamily = initialFamily(requested)
  const candidateFamily = initialFamily(candidate)
  const bothHorizontal = ['upward', 'downward', 'horizontal'].includes(requestedFamily) && ['upward', 'downward', 'horizontal'].includes(candidateFamily)
  const layoutDistance = requestedFamily === candidateFamily ? 0 : bothHorizontal ? 1 : 4
  return layoutDistance + (sameFinal ? 0 : 2) + Math.abs(requested - candidate) / 10
}

export function selectJamoSource<T extends { sourceRole?: HangulRole }>(
  sources: Map<string, T>, role: HangulRole, variant: number, char: string,
): { source: T; key: string; match: SourceMatch } | undefined {
  const exactKey = sourceKey(role, variant, char)
  const exact = sources.get(exactKey)
  if (exact) return { source: exact, key: exactKey, match: 'exact' }
  const count = role === 'initial' ? 8 : role === 'medial' ? 2 : 1
  const alternatives = Array.from({ length: count }, (_, index) => ({
    index, key: sourceKey(role, index, char), source: sources.get(sourceKey(role, index, char)),
  })).filter((candidate): candidate is { index: number; key: string; source: T } => Boolean(candidate.source))
  alternatives.sort((a, b) => candidateScore(role, variant, a.index) - candidateScore(role, variant, b.index) || a.index - b.index)
  if (alternatives.length) return { source: alternatives[0].source, key: alternatives[0].key, match: 'same-role' }
  const base = sources.get(char)
  if (!base) return undefined
  return { source: base, key: char, match: base.sourceRole && base.sourceRole !== role ? 'cross-role' : 'base' }
}
