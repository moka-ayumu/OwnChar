import { BASE_CHARACTER_PROMPTS, CHARACTER_PROMPTS, promptRole } from '@/collection/prompts'
import type { DrawingRecord } from '@/collection/records'
import { COMPOUND_FINALS, decomposeHangul, isHangulSyllable, syllableRoles, type HangulRole } from '@/font/hangul'
import { selectJamoSource, sourceKey, type SourceMatch } from '@/font/layout/source-selection'

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

export function glyphSources(codePoint: number, drawings: Record<string, DrawingRecord>): GlyphSource[] {
  const source = (record: DrawingRecord) => ({ originPromptId: record.derivedFromPromptId ?? record.promptId, capture: record.capture })
  if (!isHangulSyllable(codePoint)) {
    const prompt = BASE_CHARACTER_PROMPTS.find((candidate) => candidate.codePoint === codePoint)
    const record = prompt && drawings[prompt.id]
    if (!record) return []
    return [{ role: promptRole(record.derivedFromPromptId), symbol: prompt.group === 'symbol', char: String.fromCodePoint(codePoint), match: 'direct', ...source(record) }]
  }
  const records = new Map<string, DrawingRecord & { sourceRole?: HangulRole }>()
  for (const prompt of CHARACTER_PROMPTS) {
    const record = drawings[prompt.id]
    if (!record?.elements.length) continue
    const key = prompt.variantRole ? sourceKey(prompt.variantRole, prompt.variantIndex!, prompt.char) : prompt.char
    records.set(key, { ...record, sourceRole: promptRole(record.derivedFromPromptId) })
  }
  const { chars, variants } = decomposeHangul(codePoint)
  return syllableRoles(codePoint).flatMap((role): GlyphSource[] => {
    const char = chars[role]
    const selected = selectJamoSource(records, role, variants[role], char)
    if (selected) return [{ role, char, match: selected.match, ...source(selected.source) }]
    // Mirrors the compound-final synthesis in `shapesFromRequestDrawings`.
    const parts = role === 'final' ? COMPOUND_FINALS[char] : undefined
    const partRecords = parts?.map((part) => records.get(sourceKey('final', 0, part)))
    if (parts && partRecords?.every(Boolean)) return partRecords.map((record, index) => ({ role, char: parts[index], match: 'compound', ...source(record!) }))
    return [{ role, char, match: 'missing', originPromptId: '' }]
  })
}
