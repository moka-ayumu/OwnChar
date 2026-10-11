import type { HangulRole } from '@/font/hangul'

/**
 * exact: written in this very context. derived: the same jamo written in
 * another context of the same role, fitted into the requested layout.
 */
export type SourceMatch = 'exact' | 'derived' | 'base' | 'cross-role'

export function sourceKey(role: HangulRole, variant: number, char: string) {
  return `${role}:${variant}:${char}`
}

// Initial layouts, in order of how well each one stands in for another.
// 0 vertical, 1 ㅗ/ㅛ/ㅡ, 2 ㅜ/ㅠ, 3 ㅘ/ㅙ/ㅚ/ㅢ, 4 ㅝ/ㅞ/ㅟ; 5–7 the same
// families with a final. ㅜ shares the ㅗ zone. The compound-vowel layouts sit
// in a compact top-left zone closest to the vertical initial, but their
// initial rests on a horizontal bar, so they take the ㅗ layouts before the
// vertical ones, whose tall initial would reach down into that bar.
const INITIAL_DONORS: Record<number, number[]> = {
  0: [5, 3, 4, 7, 1, 2, 6],
  1: [2, 6, 0, 5, 3, 4, 7],
  2: [1, 6, 0, 5, 3, 4, 7],
  3: [4, 7, 1, 2, 6, 5, 0],
  4: [3, 7, 1, 2, 6, 5, 0],
  5: [0, 7, 3, 4, 6, 1, 2],
  6: [1, 2, 5, 0, 7, 3, 4],
  7: [3, 4, 6, 1, 2, 5, 0],
}

export function donors(role: HangulRole, variant: number) {
  if (role === 'initial') return INITIAL_DONORS[variant] ?? []
  if (role === 'medial') return [1 - variant]
  return []
}

export function selectJamoSource<T extends { sourceRole?: HangulRole }>(
  sources: Map<string, T>, role: HangulRole, variant: number, char: string,
): { source: T; key: string; match: SourceMatch } | undefined {
  const exactKey = sourceKey(role, variant, char)
  const exact = sources.get(exactKey)
  if (exact) return { source: exact, key: exactKey, match: 'exact' }
  for (const index of donors(role, variant)) {
    const key = sourceKey(role, index, char)
    const source = sources.get(key)
    if (source) return { source, key, match: 'derived' }
  }
  const base = sources.get(char)
  if (!base) return undefined
  return { source: base, key: char, match: base.sourceRole && base.sourceRole !== role ? 'cross-role' : 'base' }
}
