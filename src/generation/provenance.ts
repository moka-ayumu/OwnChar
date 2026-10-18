import { BASE_CHARACTER_PROMPTS, promptRole } from '@/collection/prompts'
import type { DrawingRecord } from '@/collection/records'
import { decomposeHangul, HANGUL_BASE, isHangulSyllable, jamoParts, syllableRoles, type HangulRole } from '@/font/hangul'
import type { NormalizedShape } from '@/font/geometry/shape'
import { selectJamoSource, type SourceMatch } from '@/font/layout/source-selection'

/** Where the ink of one part of a glyph was written. */
export interface GlyphSource {
  /** The jamo role the ink plays, or was captured in; undefined for a plain character. */
  role?: HangulRole
  symbol?: boolean
  char: string
  match: SourceMatch | 'compound' | 'direct' | 'missing'
  originPromptId: string
  capture?: DrawingRecord['capture']
}

type Drawings = Record<string, DrawingRecord>

/** Where the ink of a glyph came from. A syllable reads the origins the synthesis recorded on `shapes`. */
export function glyphSources(codePoint: number, drawings: Drawings, shapes: Map<string, NormalizedShape>): GlyphSource[] {
  if (!isHangulSyllable(codePoint)) {
    const prompt = BASE_CHARACTER_PROMPTS.find((candidate) => candidate.codePoint === codePoint)
    const record = prompt && drawings[prompt.id]
    if (!record) return []
    return [{ role: promptRole(record.derivedFromPromptId), symbol: prompt.group === 'symbol', char: String.fromCodePoint(codePoint), match: 'direct', originPromptId: record.derivedFromPromptId ?? record.promptId, capture: record.capture }]
  }
  return syllableSources(codePoint, drawings, shapes)
}

function syllableSources(codePoint: number, drawings: Drawings, shapes: Map<string, NormalizedShape>): GlyphSource[] {
  const origin = (originPromptId: string) => ({ originPromptId, capture: drawings[originPromptId]?.capture })
  const { chars, variants } = decomposeHangul(codePoint)
  return syllableRoles(codePoint).flatMap((role): GlyphSource[] => {
    const char = chars[role]
    const selected = selectJamoSource(shapes, role, variants[role], char)
    const origins = selected?.source.originPromptIds
    if (!selected || !origins?.length) return [{ role, char, match: 'missing', originPromptId: '' }]
    if (!selected.source.synthesized) return [{ role, char, match: selected.match, ...origin(origins[0]) }]
    const parts = [...new Set(jamoParts(char))]
    return origins.map((id, index) => ({ role, char: parts[index] ?? char, match: 'compound', ...origin(id) }))
  })
}

export interface GlyphCoverage {
  /** Every jamo was written in the very context the syllable needs. */
  exact: number
  /** Some jamo come from another context of the same jamo, or are put together from parts. */
  adapted: number
  /** A jamo of the syllable was never written. */
  missing: number
}

/** How the 11,172 syllables stand on the handwriting: written as they are, adapted from other contexts, or not makable. */
export function glyphCoverage(drawings: Drawings, shapes: Map<string, NormalizedShape>): GlyphCoverage {
  const total: GlyphCoverage = { exact: 0, adapted: 0, missing: 0 }
  for (let index = 0; index < 11172; index++) {
    const sources = syllableSources(HANGUL_BASE + index, drawings, shapes)
    if (sources.some((item) => item.match === 'missing')) total.missing++
    else if (sources.every((item) => item.match === 'exact')) total.exact++
    else total.adapted++
  }
  return total
}
