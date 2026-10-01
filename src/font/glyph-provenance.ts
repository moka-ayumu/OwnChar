import { CHARACTER_PROMPTS, COMPOUND_FINALS } from '@/lib/prompts'
import type { DrawingRecord, HangulRole } from '@/types/project'
import { CHOSEONG, JONGSEONG, JUNGSEONG, getHangulVariantSelection, variantShapeKey } from './hangul'
import { selectJamoSource, type SourceMatch } from './source-selection'

export interface GlyphSource {
  role: string
  char: string
  match: SourceMatch | 'compound' | 'direct' | 'missing'
  originPromptId: string
  capture?: DrawingRecord['capture']
}

function sourceRole(record: DrawingRecord): HangulRole | undefined {
  const role = record.derivedFromPromptId?.split('-')[0]
  return role === 'initial' || role === 'medial' || role === 'final' ? role : undefined
}

export function glyphSources(codePoint: number, drawings: Record<string, DrawingRecord>): GlyphSource[] {
  const map = new Map<string, DrawingRecord & { sourceRole?: HangulRole }>()
  for (const prompt of CHARACTER_PROMPTS) {
    const record = drawings[prompt.id]
    if (!record || (!record.elements.length && !record.paths.length)) continue
    const key = prompt.variantRole ? variantShapeKey(prompt.variantRole, prompt.variantIndex!, prompt.char) : prompt.char
    map.set(key, Object.assign({}, record, { sourceRole: sourceRole(record) }))
  }
  const make = (role: string, char: string, record: DrawingRecord, match: GlyphSource['match']): GlyphSource => ({
    role, char, match, originPromptId: record.derivedFromPromptId ?? record.promptId, capture: record.capture,
  })
  if (codePoint < 0xac00 || codePoint > 0xd7a3) {
    const prompt = CHARACTER_PROMPTS.find((candidate) => candidate.codePoint === codePoint && !candidate.variantRole)
    const record = prompt && drawings[prompt.id]
    return record ? [make(prompt?.group === 'symbol' ? '기호' : sourceRole(record) ?? '글자', String.fromCodePoint(codePoint), record, 'direct')] : []
  }
  const offset = codePoint - 0xac00
  const initial = Math.floor(offset / 588)
  const medial = Math.floor((offset % 588) / 28)
  const final = offset % 28
  const variants = getHangulVariantSelection(codePoint)
  const roles: Array<{ role: HangulRole; char: string; variant: number }> = [
    { role: 'initial', char: CHOSEONG[initial][0], variant: variants.initial },
    { role: 'medial', char: JUNGSEONG[medial][0], variant: variants.medial },
  ]
  if (final) roles.push({ role: 'final', char: JONGSEONG[final][0], variant: variants.final })
  return roles.flatMap(({ role, char, variant }) => {
    const selected = selectJamoSource(map, role, variant, char)
    if (selected) return [make(role, char, selected.source, selected.match)]
    // Mirrors the compound-final synthesis in `shapesFromRequestDrawings`.
    const parts = role === 'final' ? COMPOUND_FINALS[char] : undefined
    const records = parts?.map((part) => map.get(variantShapeKey('final', 0, part)))
    if (parts && records?.every(Boolean)) return records.map((record, index) => make(role, parts[index], record!, 'compound'))
    return [{ role, char, match: 'missing', originPromptId: '' }]
  })
}
