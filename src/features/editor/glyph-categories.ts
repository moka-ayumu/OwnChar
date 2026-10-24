import { BASE_CHARACTER_PROMPTS } from '@/collection/prompts'
import { FINALS, HANGUL_BASE, HANGUL_COUNT, INITIALS, MEDIALS } from '@/font/hangul'

export type GlyphCategory = 'hangul' | 'jamo' | 'latin' | 'symbol'

export const GLYPH_CATEGORIES: ReadonlyArray<readonly [GlyphCategory, string]> = [['hangul', '한글'], ['jamo', '자모'], ['latin', '영문'], ['symbol', '숫자·기호']]

const GROUP_CATEGORY: Record<string, GlyphCategory> = { consonant: 'jamo', vowel: 'jamo', uppercase: 'latin', lowercase: 'latin', number: 'symbol', symbol: 'symbol' }

export const CODE_POINTS: Record<GlyphCategory, number[]> = {
  hangul: Array.from({ length: HANGUL_COUNT }, (_, index) => HANGUL_BASE + index),
  jamo: [],
  latin: [],
  symbol: [],
}

const BASE_CATEGORY = new Map<number, GlyphCategory>()
for (const prompt of BASE_CHARACTER_PROMPTS) {
  const category = GROUP_CATEGORY[prompt.group]
  CODE_POINTS[category].push(prompt.codePoint)
  BASE_CATEGORY.set(prompt.codePoint, category)
}

const isHangul = (codePoint: number) => codePoint >= HANGUL_BASE && codePoint < HANGUL_BASE + HANGUL_COUNT

export const categoryOf = (codePoint: number): GlyphCategory | undefined => isHangul(codePoint) ? 'hangul' : BASE_CATEGORY.get(codePoint)

export const isGlyph = (codePoint: number) => categoryOf(codePoint) !== undefined

export interface HangulFilter { initials: string[]; medials: string[]; finals: string[] }

export const NO_FILTER: HangulFilter = { initials: [], medials: [], finals: [] }

export const VOWEL_SHAPES: ReadonlyArray<readonly [string, string[]]> = [
  ['세로 모음', [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅣ']],
  ['가로 모음', [...'ㅗㅛㅜㅠㅡ']],
  ['혼합 모음', [...'ㅘㅙㅚㅝㅞㅟㅢ']],
]

export const isFiltering = (filter: HangulFilter) => filter.initials.length + filter.medials.length + filter.finals.length > 0

const indexes = (chosen: string[], all: string[]) => chosen.length ? all.flatMap((jamo, index) => chosen.includes(jamo) ? [index] : []) : all.map((_, index) => index)

/** The syllables whose initial, medial and final each lie in the chosen jamo; a part with none chosen takes any. */
export function filterHangul(filter: HangulFilter) {
  const result: number[] = []
  for (const initial of indexes(filter.initials, INITIALS)) {
    for (const medial of indexes(filter.medials, MEDIALS)) {
      for (const final of indexes(filter.finals, FINALS)) result.push(HANGUL_BASE + (initial * MEDIALS.length + medial) * FINALS.length + final)
    }
  }
  return result
}
