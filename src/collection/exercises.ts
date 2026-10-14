import { decomposeHangul, isHangulSyllable, syllableRoles, type HangulRole } from '@/font/hangul'
import { basePromptId, promptRole, SYMBOLS, variantPromptId } from './prompts'
import type { DrawingRecord, WritingSessionRecord } from './records'

/**
 * What a sentence shows of the jamo already collected. `blank`: nothing, every
 * cell is written in full. `collected`: the collected jamo as fixed gray ink.
 * `placement`: the fixed jamo and the places of the jamo still to be written.
 */
export type GuideMode = 'blank' | 'collected' | 'placement'

/** Which slots a cell holds fixed, apart from its jamo being collected elsewhere. */
export interface FixedRule {
  mode: GuideMode
  /** The roles a cell keeps fixed since its first stroke. A cell listed here ignores `mode`. */
  pinned: Readonly<Record<number, readonly HangulRole[]>>
}

export interface CaptureSlot {
  promptId: string
  char: string
  role?: HangulRole
  expectedStrokes: number
}

export interface WritingCell {
  char: string
  /** What the cell collects, in writing order: the jamo of a syllable, or the character itself. */
  slots: CaptureSlot[]
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

/** How many strokes a jamo is usually written with. */
export function expectedStrokeCount(char: string) {
  return STROKE_COUNTS[char] ?? 1
}

/** The contextual jamo a syllable collects; nothing for any other character. */
function hangulSlots(char: string): CaptureSlot[] {
  const codePoint = char.codePointAt(0)!
  if (!isHangulSyllable(codePoint)) return []
  const { chars, variants } = decomposeHangul(codePoint)
  return syllableRoles(codePoint).map((role) => ({
    promptId: variantPromptId(role, variants[role], chars[role]),
    char: chars[role],
    role,
    expectedStrokes: expectedStrokeCount(chars[role]),
  }))
}

// Natural sentences that together contain every required contextual jamo
// (see `isRequiredPrompt`). Rarer shapes that happen to appear are collected
// too; the rest are derived during composition.
const HANGUL_SENTENCES = [
  '흐린 퇴근길 휴대폰에 육 년 만에 옛 친구의 문자가 왔다',
  '관람권 사진과 극장 출구 뒤편 벤치에서 십 분만 보자는 얘기였다',
  '저녁녘 택시가 모퉁이를 도니 스웨터에 코트를 걸친 친구가 왼손으로 노란 꽃을 흔들었다',
  '예전 그 시절이 꽤 좋았냐고 낮게 묻더니 바로 옆에서 내 표정을 살폈다',
  '뭐라 답할지 몰라 커피컵을 쥔 채 초콜릿 향만 맡으며 조용히 웃었다',
]

const hangulExercises: WritingExercise[] = HANGUL_SENTENCES.map((text, index) => ({
  id: `hangul-sentence-${index}`,
  title: `한글 문장 ${index + 1}`,
  instruction: '문장을 평소 글씨처럼 이어서 쓰세요. 한 음절의 획은 초성·중성·종성 순서로 자동 분리됩니다.',
  text,
  cells: [...text].map((char) => ({ char, slots: hangulSlots(char) })),
  group: 'hangul',
}))

function latinExercise(id: string, text: string, group: 'uppercase' | 'lowercase'): WritingExercise {
  return {
    id,
    title: group === 'uppercase' ? '영문 대문자' : '영문 소문자',
    instruction: '각 칸에서 글자를 시작하면 칸 밖으로 획이 나가도 해당 글자로 저장됩니다.',
    text,
    cells: [...text].map((char) => ({
      char,
      slots: /[A-Za-z]/.test(char) ? [{ promptId: basePromptId(group, char), char, expectedStrokes: 1 }] : [],
    })),
    group: 'latin',
  }
}

const numberSymbolText = ['0123456789', ...SYMBOLS].join('')
const numberSymbolExercise: WritingExercise = {
  id: 'numbers-symbols',
  title: '숫자와 기호',
  instruction: '각 칸의 숫자와 기호를 평소 쓰는 위치와 크기로 적으세요.',
  text: numberSymbolText,
  cells: [...numberSymbolText].map((char) => ({
    char,
    slots: [{ promptId: basePromptId(/[0-9]/.test(char) ? 'number' : 'symbol', char), char, expectedStrokes: 1 }],
  })),
  group: 'symbol',
}

export const WRITING_EXERCISES: WritingExercise[] = [
  ...hangulExercises,
  latinExercise('latin-uppercase', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'uppercase'),
  latinExercise('latin-lowercase', 'abcdefghijklmnopqrstuvwxyz', 'lowercase'),
  numberSymbolExercise,
]

/** The drawings a sentence's session holds: its saved captures, or for a session saved before captures were kept, its drawings. */
export function sessionCaptures(exerciseId: string, session: WritingSessionRecord | undefined, drawings: Record<string, DrawingRecord>) {
  return session?.captures ?? Object.values(drawings).filter((drawing) => drawing.capture.exerciseId === exerciseId && !drawing.derivedFromPromptId)
}

/**
 * How far a sentence has come. With the collected jamo shown fixed, that is
 * the kinds of jamo it holds that are collected anywhere. With blank cells, it
 * is the jamo written in the sentence's own cells.
 */
export function exerciseCompletion(exercise: WritingExercise, drawings: Record<string, DrawingRecord>, session?: WritingSessionRecord, mode: GuideMode = 'placement') {
  if (mode !== 'blank') {
    const ids = new Set(exercise.cells.flatMap((cell) => cell.slots.map((slot) => slot.promptId)))
    const completed = [...ids].filter((id) => drawings[id]).length
    return { completed, total: ids.size }
  }
  const written = new Set(sessionCaptures(exercise.id, session, drawings).map(({ capture }) => `${capture.cellIndex}:${capture.slotIndex}`))
  let completed = 0
  let total = 0
  exercise.cells.forEach((cell, cellIndex) => cell.slots.forEach((_, slotIndex) => {
    total += 1
    if (written.has(`${cellIndex}:${slotIndex}`)) completed += 1
  }))
  return { completed, total }
}

/**
 * A slot is fixed when its jamo was already captured somewhere other than this
 * slot, and the cell shows collected jamo. A cell already written keeps the
 * fixed roles it had when its first stroke began (`rule.pinned`).
 */
export function isFixedSlot(promptId: string, cellIndex: number, slotIndex: number, exercise: WritingExercise, drawings: Record<string, DrawingRecord>, rule?: FixedRule) {
  const capture = drawings[promptId]?.capture
  if (!capture) return false
  if (capture.exerciseId === exercise.id && capture.cellIndex === cellIndex && capture.slotIndex === slotIndex) return false
  if (!rule) return true
  const pinned = rule.pinned[cellIndex]
  if (pinned) return pinned.includes(promptRole(promptId)!)
  return rule.mode !== 'blank'
}
