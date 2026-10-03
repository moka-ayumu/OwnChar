type OverlapBoundary = 'initial-medial' | 'medial-final'

interface OverlapRule {
  boundary: OverlapBoundary
  first: readonly string[]
  second: readonly string[] | '*'
}

const TOP_FINALS = [...'ㄲㄳㄴㄵㄶㄺㄻㄼㄽㄾㄿㅀㅂㅄㅆ']

// Jamo pairs whose shapes leave a notch the neighbour may reach into.
const OVERLAP_RULES: readonly OverlapRule[] = [
  // A vowel arm entering the open right side of the initial.
  { boundary: 'initial-medial', first: [...'ㄴㄷㄸㄹㅅㅆㅈㅉㅊㅌㅍ'], second: [...'ㅓㅕㅔㅖ'] },
  // An upward vowel stem entering the open bottom of the initial.
  { boundary: 'initial-medial', first: [...'ㄱㄲㄸㅃㅅㅆㅈㅉㅊㅋ'], second: [...'ㅗㅘㅙㅚ'] },
  { boundary: 'initial-medial', first: [...'ㄱㄲㅅㅆㅈㅉㅊㅋ'], second: ['ㅛ'] },
  // A downward vowel stem entering the open top of the final.
  { boundary: 'medial-final', first: ['ㅜ'], second: TOP_FINALS },
  { boundary: 'medial-final', first: [...'ㅝㅞㅟ'], second: TOP_FINALS },
  { boundary: 'medial-final', first: ['ㅠ'], second: '*' },
]

export function allowsOverlap(boundary: OverlapBoundary, first: string, second: string) {
  return OVERLAP_RULES.some((rule) => rule.boundary === boundary && rule.first.includes(first) && (rule.second === '*' || rule.second.includes(second)))
}
