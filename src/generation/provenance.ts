import { BASE_CHARACTER_PROMPTS, CHARACTER_PROMPTS, promptRole } from '@/collection/prompts'
import type { DrawingRecord } from '@/collection/records'
import { COMPOUND_FINALS, decomposeHangul, DOUBLE_CONSONANTS, HANGUL_BASE, isHangulSyllable, syllableRoles, type HangulRole } from '@/font/hangul'
import { donors, selectJamoSource, sourceKey, type SourceMatch } from '@/font/layout/source-selection'

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
  return syllableSources(codePoint, jamoRecords(drawings))
}

type JamoRecords = Map<string, DrawingRecord & { sourceRole?: HangulRole }>

/** Every written jamo by its context, as source selection looks them up. */
function jamoRecords(drawings: Record<string, DrawingRecord>): JamoRecords {
  const records: JamoRecords = new Map()
  for (const prompt of CHARACTER_PROMPTS) {
    const record = drawings[prompt.id]
    if (!record?.elements.length) continue
    const key = prompt.variantRole ? sourceKey(prompt.variantRole, prompt.variantIndex!, prompt.char) : prompt.char
    records.set(key, { ...record, sourceRole: promptRole(record.derivedFromPromptId) })
  }
  return records
}

function syllableSources(codePoint: number, records: JamoRecords): GlyphSource[] {
  const source = (record: DrawingRecord) => ({ originPromptId: record.derivedFromPromptId ?? record.promptId, capture: record.capture })
  const { chars, variants } = decomposeHangul(codePoint)
  return syllableRoles(codePoint).flatMap((role): GlyphSource[] => {
    const char = chars[role]
    const selected = selectJamoSource(records, role, variants[role], char)
    if (selected) return [{ role, char, match: selected.match, ...source(selected.source) }]
    // Mirrors the synthesis of compound finals and double consonants in `shapesFromRequestDrawings`.
    const parts = char in DOUBLE_CONSONANTS ? [DOUBLE_CONSONANTS[char]] : role === 'final' ? COMPOUND_FINALS[char] : undefined
    const partRecords = parts?.map((part) => [variants[role], ...donors(role, variants[role])].map((variant) => records.get(sourceKey(role, variant, part))).find(Boolean))
    if (parts && partRecords?.every(Boolean)) return partRecords.map((record, index) => ({ role, char: parts[index], match: 'compound', ...source(record!) }))
    return [{ role, char, match: 'missing', originPromptId: '' }]
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
export function glyphCoverage(drawings: Record<string, DrawingRecord>): GlyphCoverage {
  const records = jamoRecords(drawings)
  const total: GlyphCoverage = { exact: 0, adapted: 0, missing: 0 }
  for (let index = 0; index < 11172; index++) {
    const sources = syllableSources(HANGUL_BASE + index, records)
    if (sources.some((item) => item.match === 'missing')) total.missing++
    else if (sources.every((item) => item.match === 'exact')) total.exact++
    else total.adapted++
  }
  return total
}
