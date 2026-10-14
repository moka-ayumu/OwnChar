import { COMPOUND_FINALS } from '@/font/hangul'
import { minimumGap } from './gap-profile'

type OverlapBoundary = 'initial-medial' | 'medial-final'

interface OverlapRule {
  boundary: OverlapBoundary
  first: readonly string[]
  second: readonly string[]
}

/** Vowels whose stem reaches down toward the final. */
const STEM_DOWN_MEDIALS = [...'ㅜㅠㅝㅞㅟ']
/** Vowels whose vertical stem ends above the final. */
const STEM_END_MEDIALS = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅣ']
/** Finals made of two consonants side by side. */
const MULTI_FINALS = [...'ㄲㅆ', ...Object.keys(COMPOUND_FINALS)]

// Jamo pairs whose shapes leave a notch the neighbour may reach into.
const OVERLAP_RULES: readonly OverlapRule[] = [
  // A vowel arm entering the open right side of the initial.
  { boundary: 'initial-medial', first: [...'ㄴㄷㄸㄹㅅㅆㅈㅉㅊㅌㅍ'], second: [...'ㅓㅕㅔㅖ'] },
  // An upward vowel stem entering the open bottom of the initial.
  { boundary: 'initial-medial', first: [...'ㄱㄲㄸㅃㅅㅆㅈㅉㅊㅋ'], second: [...'ㅗㅘㅙㅚ'] },
  { boundary: 'initial-medial', first: [...'ㄱㄲㅅㅆㅈㅉㅊㅋ'], second: ['ㅛ'] },
  // A downward vowel stem entering the open top of the final.
  { boundary: 'medial-final', first: STEM_DOWN_MEDIALS, second: [...'ㄴㅂ'] },
  // The end of a vertical stem entering the open top or the shoulder of the final.
  { boundary: 'medial-final', first: STEM_END_MEDIALS, second: [...'ㄴㅅㅊ'] },
]

export function allowsOverlap(boundary: OverlapBoundary, first: string, second: string) {
  return OVERLAP_RULES.some((rule) => rule.boundary === boundary && rule.first.includes(first) && rule.second.includes(second))
}

/** Least distance between the upper body's box and the final's box; negative where the final may interlock. */
export function finalBoxGap(medial: string, final: string) {
  // The stem enters the final by no more than the gap it would otherwise keep.
  if (allowsOverlap('medial-final', medial, final)) return -minimumGap
  // Between two consonants the stem has room to come down to their top edge.
  return STEM_DOWN_MEDIALS.includes(medial) && MULTI_FINALS.includes(final) ? 0 : minimumGap
}
