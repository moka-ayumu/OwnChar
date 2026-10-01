import { CHOSEONG, JONGSEONG, JUNGSEONG, getHangulVariantSelection } from '@/font/hangul'
import { HANGUL_VARIANT_PROMPTS, isRequiredPrompt, SYMBOLS } from '@/lib/prompts'
import type { HangulRole } from '@/types/project'

export interface CaptureSlot {
  promptId: string
  char: string
  role?: HangulRole
  expectedStrokes: number
}

export interface WritingCell {
  char: string
  slots: CaptureSlot[]
  guides?: CaptureSlot[]
}

export interface WritingExercise {
  id: string
  title: string
  instruction: string
  text: string
  cells: WritingCell[]
  group: 'hangul' | 'latin' | 'number' | 'symbol'
}

const STROKE_COUNTS: Record<string, number> = {
  ㄱ: 1, ㄴ: 1, ㄷ: 2, ㄹ: 3, ㅁ: 3, ㅂ: 4, ㅅ: 2,
  ㅇ: 1, ㅈ: 3, ㅊ: 4, ㅋ: 2, ㅌ: 3, ㅍ: 4, ㅎ: 3,
  ㄲ: 2, ㄳ: 3, ㄵ: 4, ㄶ: 4, ㄸ: 4, ㄺ: 4, ㄻ: 4,
  ㄼ: 5, ㄽ: 5, ㄾ: 4, ㄿ: 5, ㅀ: 6, ㅃ: 8, ㅄ: 6, ㅆ: 4, ㅉ: 6,
  ㅏ: 2, ㅑ: 3, ㅓ: 2, ㅕ: 3, ㅗ: 2, ㅛ: 3, ㅜ: 2,
  ㅠ: 3, ㅡ: 1, ㅣ: 1,
  ㅐ: 3, ㅒ: 4, ㅔ: 3, ㅖ: 4, ㅘ: 4, ㅙ: 5,
  ㅚ: 3, ㅝ: 4, ㅞ: 5, ㅟ: 3, ㅢ: 2,
}

export function hangulSlots(char: string): CaptureSlot[] {
  const codePoint = char.codePointAt(0)!
  if (codePoint < 0xac00 || codePoint > 0xd7a3) return []
  const offset = codePoint - 0xac00
  const initialIndex = Math.floor(offset / 588)
  const medialIndex = Math.floor((offset % 588) / 28)
  const finalIndex = offset % 28
  const variants = getHangulVariantSelection(codePoint)
  const make = (component: string, role: HangulRole): CaptureSlot => ({
    promptId: `${role}-${variants[role]}-${component.codePointAt(0)}`,
    char: component,
    role,
    expectedStrokes: STROKE_COUNTS[component] ?? 1,
  })
  return [
    ...CHOSEONG[initialIndex].map((component) => make(component, 'initial')),
    ...JUNGSEONG[medialIndex].map((component) => make(component, 'medial')),
    ...JONGSEONG[finalIndex].map((component) => make(component, 'final')),
  ]
}

function cellsFor(text: string): WritingCell[] {
  return [...text].map((char) => ({ char, slots: hangulSlots(char) }))
}

// Natural sentences that together contain every required contextual jamo
// (see `isRequiredPrompt`). Rarer shapes that happen to appear are collected
// too; the rest are derived during composition.
const HANGUL_SENTENCES = [
  '배고픈 너구리가 몰래 부엌에서 닭볶음탕을 끓여 먹었대요',
  '야, 얘가 퀴즈왕이래! 예쁜 웨딩 케이크를 통째로 뚝딱 만들었대',
  '곧 옛 친구가 웬일로 쌀 한 포대와 칼국수 육수를 챙겨 왔어',
  '왜 하필 오늘 햇볕 쬐며 툇마루에 앉아 시를 읊고 싶을까',
  '뽀얀 타조가 깜짝 놀라 쿵 넘어지자 빵 봉지를 물고 쏙 숨었다',
  '휴, 바빠서 약속을 또 잊었네, 넷이서 좀 모였다가 쭉 춤추러 가자',
  '의자 밑 흙 속에 윗집 강아지가 원래 보물을 숨겼대, 용케 찾았지',
  '꽃밭에서 도토리 밥을 먹고 잠든 토끼, 사랑스러워 참 좋다',
  '떼쓰던 꼬마가 호호 웃으며 싸 온 초코 파이를 치즈와 쪼개 노나 줬어',
]

const hangulExercises: WritingExercise[] = HANGUL_SENTENCES.map((text, index) => ({
  id: `hangul-sentence-${index}`,
  title: `한글 문장 ${index + 1}`,
  instruction: '문장을 평소 글씨처럼 이어서 써주세요. 한 음절의 획은 초성·중성·종성 순서로 자동 분리되고, 이미 모은 자모는 회색으로 고정됩니다.',
  text,
  cells: cellsFor(text),
  group: 'hangul',
}))

function latinExercise(id: string, text: string, group: 'uppercase' | 'lowercase'): WritingExercise {
  return {
    id,
    title: group === 'uppercase' ? '영문 대문자 문장' : '영문 소문자 문장',
    instruction: '각 칸에서 글자를 시작하면 칸 밖으로 획이 나가도 해당 글자로 저장됩니다.',
    text,
    cells: [...text].map((char) => ({
      char,
      slots: /[A-Za-z]/.test(char) ? [{
        promptId: `${group}-${char.codePointAt(0)}`,
        char,
        expectedStrokes: 1,
      }] : [],
    })),
    group: 'latin',
  }
}

const latinExercises = [
  latinExercise('latin-uppercase', 'PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS', 'uppercase'),
  latinExercise('latin-lowercase', 'pack my box with five dozen liquor jugs', 'lowercase'),
]

const numberSymbolText = ['0123456789', ...SYMBOLS].join('')
const numberSymbolExercise: WritingExercise = {
  id: 'numbers-symbols',
  title: '숫자와 기호',
  instruction: '각 칸의 숫자와 기호를 평소 쓰는 위치와 크기로 적어주세요.',
  text: numberSymbolText,
  cells: [...numberSymbolText].map((char) => {
    const group = /[0-9]/.test(char) ? 'number' : 'symbol'
    return { char, slots: [{ promptId: `${group}-${char.codePointAt(0)}`, char, expectedStrokes: 1 }] }
  }),
  group: 'symbol',
}

export function buildWritingExercises(): WritingExercise[] {
  return [...hangulExercises, ...latinExercises, numberSymbolExercise]
}

export const WRITING_EXERCISES: WritingExercise[] = buildWritingExercises()

export const WRITING_EXERCISE_COUNT = WRITING_EXERCISES.length

export function exerciseCompletion(exercise: WritingExercise, drawings: Record<string, unknown>) {
  const ids = new Set(exercise.cells.flatMap((cell) => cell.slots.map((slot) => slot.promptId)))
  const completed = [...ids].filter((id) => drawings[id]).length
  return { completed, total: ids.size }
}

/** Where a prompt is written in the current exercises, for records captured by a retired exercise. */
export function locatePromptSlot(promptId: string, exercises = WRITING_EXERCISES) {
  for (const exercise of exercises) {
    const cellIndex = exercise.cells.findIndex((cell) => cell.slots.some((slot) => slot.promptId === promptId))
    if (cellIndex >= 0) return { exercise, cellIndex }
  }
  return undefined
}

export function validateWritingExercises(exercises = WRITING_EXERCISES) {
  const targetIds = new Set(exercises.flatMap((exercise) => exercise.cells.flatMap((cell) => cell.slots.map((slot) => slot.promptId))))
  const missingVariantPromptIds = HANGUL_VARIANT_PROMPTS.filter((prompt) => isRequiredPrompt(prompt) && !targetIds.has(prompt.id)).map((prompt) => prompt.id)
  const invalidHangulSlotIds = exercises.flatMap((exercise) => exercise.cells.flatMap((cell) =>
    [...cell.slots, ...(cell.guides ?? [])]
      .filter((slot) => slot.role && !slot.promptId.startsWith(`${slot.role}-`))
      .map((slot) => `${exercise.id}:${cell.char}:${slot.role}:${slot.promptId}`),
  ))
  return { missingVariantPromptIds, invalidHangulSlotIds }
}

const exerciseValidation = validateWritingExercises()
if (exerciseValidation.missingVariantPromptIds.length || exerciseValidation.invalidHangulSlotIds.length) {
  throw new Error(`Invalid writing exercise plan: ${JSON.stringify(exerciseValidation)}`)
}
