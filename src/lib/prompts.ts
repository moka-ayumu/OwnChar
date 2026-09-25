import type { CharacterPrompt, PromptGroup } from '@/types/project'

const basicConsonants = [...'ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ']
const initialConsonants = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ']
const finalConsonants = [...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']
const vowels = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ']
export const SYMBOLS = [...`.,!?;:'"()[]+-=*/<>@#%&$_`]

const groups: Array<[PromptGroup, string[]]> = [
  ['consonant', basicConsonants],
  ['vowel', vowels],
  ['uppercase', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']],
  ['lowercase', [...'abcdefghijklmnopqrstuvwxyz']],
  ['number', [...'0123456789']],
  ['symbol', SYMBOLS],
]

export const BASE_CHARACTER_PROMPTS: CharacterPrompt[] = groups.flatMap(([group, characters]) =>
  characters.map((char) => ({
    id: `${group}-${char.codePointAt(0)}`,
    char,
    codePoint: char.codePointAt(0)!,
    group,
    order: 0,
  })),
).map((prompt, order) => ({ ...prompt, order }))

const initialContexts = [
  '받침 없음 · 세로형 중성',
  '받침 없음 · ㅗ/ㅛ/ㅡ',
  '받침 없음 · ㅜ/ㅠ',
  '받침 없음 · ㅘ/ㅙ/ㅚ/ㅢ',
  '받침 없음 · ㅝ/ㅞ/ㅟ',
  '받침 있음 · 세로형 중성',
  '받침 있음 · 가로형 중성',
  '받침 있음 · 복합 중성',
] as const

const medialContexts = [
  '받침 없음',
  '받침 있음',
] as const

const finalContexts = [
  '종성 공통 배치',
] as const

const choseongChars = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ']
const jungseongChars = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ']
const jongseongChars = [...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']

function composeExample(initial: string, medial: string, final?: string) {
  const initialIndex = choseongChars.indexOf(initial)
  const medialIndex = jungseongChars.indexOf(medial)
  const finalIndex = final ? jongseongChars.indexOf(final) + 1 : 0
  if (initialIndex < 0 || medialIndex < 0 || finalIndex < 0) return initial
  return String.fromCodePoint(0xac00 + initialIndex * 588 + medialIndex * 28 + finalIndex)
}

function exampleFor(role: 'initial' | 'medial' | 'final', variantIndex: number, char: string) {
  if (role === 'initial') {
    const medials = ['ㅏ', 'ㅗ', 'ㅜ', 'ㅘ', 'ㅝ', 'ㅏ', 'ㅗ', 'ㅘ']
    return composeExample(char, medials[variantIndex], variantIndex >= 5 ? 'ㄱ' : undefined)
  }
  if (role === 'medial') {
    return composeExample('ㄱ', char, variantIndex === 1 ? 'ㄱ' : undefined)
  }
  return composeExample('ㄱ', 'ㅏ', char)
}

function variantPrompts(group: PromptGroup, role: 'initial' | 'medial' | 'final', characters: string[], contexts: readonly string[]) {
  return contexts.flatMap((contextLabel, variantIndex) => characters.map((char) => ({
    id: `${role}-${variantIndex}-${char.codePointAt(0)}`,
    char,
    codePoint: char.codePointAt(0)!,
    group,
    order: 0,
    variantRole: role,
    variantIndex,
    contextLabel,
    example: exampleFor(role, variantIndex, char),
  } satisfies CharacterPrompt)))
}

export const HANGUL_VARIANT_PROMPTS = [
  ...variantPrompts('initialVariant', 'initial', initialConsonants, initialContexts),
  ...variantPrompts('medialVariant', 'medial', vowels, medialContexts),
  ...variantPrompts('finalVariant', 'final', finalConsonants, finalContexts),
]

export const CHARACTER_PROMPTS: CharacterPrompt[] = [...BASE_CHARACTER_PROMPTS, ...HANGUL_VARIANT_PROMPTS]
  .map((prompt, order) => ({ ...prompt, order }))

export const PROMPT_COUNT = CHARACTER_PROMPTS.length

export const PROMPT_GROUP_LABELS: Record<PromptGroup, string> = {
  consonant: '기본 자음',
  vowel: '기본 모음',
  uppercase: '영문 대문자',
  lowercase: '영문 소문자',
  number: '숫자',
  symbol: '특수기호',
  initialVariant: '초성 문맥형 · 8벌',
  medialVariant: '중성 문맥형 · 2벌',
  finalVariant: '종성 문맥형 · 1벌',
}

export function completedPromptCount(drawings: Record<string, unknown>) {
  return CHARACTER_PROMPTS.reduce((count, prompt) => count + (drawings[prompt.id] ? 1 : 0), 0)
}

export function missingPrompts(drawings: Record<string, unknown>) {
  return CHARACTER_PROMPTS.filter((prompt) => !drawings[prompt.id])
}
