import { CHOSEONG, JONGSEONG, JUNGSEONG, getHangulVariantSelection } from '@/font/hangul'
import { HANGUL_VARIANT_PROMPTS, SYMBOLS } from '@/lib/prompts'
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
  group: 'hangul' | 'context' | 'latin' | 'number' | 'symbol'
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

const BASE_SENTENCES = [
  '우리 한글은 마음과 소리를 아름답게 담아요',
  '어린 고양이와 유쾌한 토끼가 푸른 들판을 힘차게 달려요',
  '조용한 새벽 바람이 창문 곁을 스쳐요',
  '좋은 글씨로 조화를 이루며 써요',
]

const baseExercises: WritingExercise[] = BASE_SENTENCES.map((text, index) => ({
  id: `hangul-base-${index}`,
  title: index === 0 ? '한글의 기본 모양' : '자연스러운 한글 문장',
  instruction: '문장을 평소 글씨처럼 이어서 써주세요. 한 음절의 획은 초성·중성·종성 순서로 자동 분리됩니다.',
  text,
  cells: cellsFor(text),
  group: 'hangul',
}))

const contextExercises: WritingExercise[] = []
const promptGroups = new Map<string, typeof HANGUL_VARIANT_PROMPTS>()
for (const prompt of HANGUL_VARIANT_PROMPTS) {
  const key = `${prompt.variantRole}-${prompt.variantIndex}`
  promptGroups.set(key, [...(promptGroups.get(key) ?? []), prompt])
}
for (const prompts of promptGroups.values()) {
  const examples = prompts.map((prompt) => prompt.example!).join('')
  const readableExamples = prompts.map((prompt) => prompt.example!).join(', ')
  const roleLabel = prompts[0].variantRole === 'initial' ? '초성' : prompts[0].variantRole === 'medial' ? '중성' : '종성'
  const variantNumber = (prompts[0].variantIndex ?? 0) + 1
  const cells = prompts.map((prompt) => {
    const allSlots = hangulSlots(prompt.example!)
    const target = allSlots.find((slot) => slot.promptId === prompt.id)!
    return {
      char: prompt.example!,
      slots: [target],
      guides: allSlots.filter((slot) => slot !== target),
    }
  })
  contextExercises.push({
    id: `hangul-${prompts[0].variantRole}-${prompts[0].variantIndex}`,
    title: `${roleLabel} 조합 모양 ${variantNumber}`,
    instruction: `${readableExamples}에서 ${roleLabel}을 앞에서부터 써주세요. 이미 수집된 자모는 고정 표시되고, 빈 자모를 함께 쓰면 자동으로 분리합니다.`,
    text: examples,
    cells,
    group: 'context',
  })
}

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

const numberText = '0123456789'
const numberExercise: WritingExercise = {
  id: 'numbers',
  title: '숫자를 차례로 써보세요',
  instruction: '자주 쓰는 숫자를 평소의 속도와 모양으로 적어주세요.',
  text: numberText,
  cells: [...numberText].map((char) => ({
    char,
    slots: [{ promptId: `number-${char.codePointAt(0)}`, char, expectedStrokes: 1 }],
  })),
  group: 'number',
}

export function buildWritingExercises(): WritingExercise[] {
  const symbolGroups = [
    { id: 'symbols-punctuation', title: '문장부호', chars: SYMBOLS.slice(0, 12) },
    { id: 'symbols-operators', title: '연산·기타 기호', chars: SYMBOLS.slice(12) },
  ]
  const symbolExercises: WritingExercise[] = symbolGroups.map(({ id, title, chars }) => ({
    id, title, group: 'symbol', text: chars.join(''),
    instruction: '각 칸의 기호를 평소 쓰는 위치와 크기로 적어주세요.',
    cells: chars.map((char) => ({ char, slots: [{ promptId: `symbol-${char.codePointAt(0)}`, char, expectedStrokes: 1 }] })),
  }))
  return [...baseExercises, ...contextExercises, ...latinExercises, numberExercise, ...symbolExercises]
}

export const WRITING_EXERCISES: WritingExercise[] = buildWritingExercises()

export const WRITING_EXERCISE_COUNT = WRITING_EXERCISES.length

export function exerciseCompletion(exercise: WritingExercise, drawings: Record<string, unknown>) {
  const ids = new Set(exercise.cells.flatMap((cell) => cell.slots.map((slot) => slot.promptId)))
  const completed = [...ids].filter((id) => drawings[id]).length
  return { completed, total: ids.size }
}

export function validateWritingExercises(exercises = WRITING_EXERCISES) {
  const targetIds = new Set(exercises.flatMap((exercise) => exercise.cells.flatMap((cell) => cell.slots.map((slot) => slot.promptId))))
  const missingVariantPromptIds = HANGUL_VARIANT_PROMPTS.filter((prompt) => !targetIds.has(prompt.id)).map((prompt) => prompt.id)
  const invalidContextCells = exercises.filter((exercise) => exercise.group === 'context').flatMap((exercise) =>
    exercise.cells.filter((cell) => cell.slots.some((slot) => slot.role !== cell.slots[0]?.role)).map((cell) => `${exercise.id}:${cell.char}`),
  )
  const invalidHangulSlotIds = exercises.flatMap((exercise) => exercise.cells.flatMap((cell) =>
    [...cell.slots, ...(cell.guides ?? [])]
      .filter((slot) => slot.role && !slot.promptId.startsWith(`${slot.role}-`))
      .map((slot) => `${exercise.id}:${cell.char}:${slot.role}:${slot.promptId}`),
  ))
  return { missingVariantPromptIds, invalidContextCells, invalidHangulSlotIds }
}

const exerciseValidation = validateWritingExercises()
if (exerciseValidation.missingVariantPromptIds.length || exerciseValidation.invalidContextCells.length || exerciseValidation.invalidHangulSlotIds.length) {
  throw new Error(`Invalid writing exercise plan: ${JSON.stringify(exerciseValidation)}`)
}
