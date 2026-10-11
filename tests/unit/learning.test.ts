import { describe, expect, test } from 'vitest'
import { WRITING_EXERCISES } from '@/collection/exercises'
import { REQUIRED_PROMPTS } from '@/collection/prompts'
import { learnGaps } from '@/generation/learning/gaps'
import { learnHangulMetrics } from '@/generation/learning/metrics'
import { learnProportions } from '@/generation/learning/proportions'
import { penStroke, sessionWriting } from './helpers'

// 좋, with ㅗ's stem reaching up between the legs of ㅈ.
const joh = () => [
  [penStroke('i1', 30, 25, [[0, 0], [50, 0]]), penStroke('i2', 30, 25, [[0, 0], [25, 35]]), penStroke('i3', 80, 25, [[0, 0], [-25, 35]])],
  [penStroke('m1', 20, 56, [[0, 0], [80, 0]]), penStroke('m2', 60, 56, [[0, 0], [0, 35]])],
  [penStroke('f1', 35, 108, [[0, 0], [45, 0]]), penStroke('f2', 42, 111, [[0, 0], [30, 20]]), penStroke('f3', 68, 111, [[0, 0], [-24, 20]])],
]

describe('learning from written sentences', () => {
  test('a complete syllable teaches its spacing; one with a stroke missing teaches nothing', () => {
    const { session } = sessionWriting('좋', joh())
    const gaps = learnGaps({ [session.exerciseId]: session })
    const upper = gaps.initialMedialSyllables['좋']
    const lower = gaps.medialFinalSyllables['좋']
    // The vowel was written overlapping the consonant's box.
    expect(upper.advanceGap).toBeLessThan(0)
    expect(upper.sampleCount).toBe(1)
    expect(gaps.horizontalUp).toBe(upper.advanceGap)
    expect(gaps.medialFinalPairs['ㅗ:ㅎ']).toEqual(lower)
    expect(gaps.finalContexts['horizontalUp:single']).toBe(lower.advanceGap)

    const metrics = learnHangulMetrics({ [session.exerciseId]: session })
    expect(metrics.hangulTargetHeight).toBeGreaterThan(600)
    expect(metrics.hangulTargetHeight).toBeLessThan(850)

    const incomplete = { ...session, assignments: session.assignments.filter((assignment) => assignment.elementId !== 'm2') }
    const nothing = learnGaps({ [session.exerciseId]: incomplete })
    expect(nothing.initialMedialSyllables['좋']).toBeUndefined()
    expect(nothing.medialFinalSyllables['좋']).toBeUndefined()
    expect(learnHangulMetrics({ [session.exerciseId]: incomplete })).toEqual({ hangulTargetHeight: 760, hangulTargetSize: 760, hangulWrittenHeight: 760, hangulWrittenSize: 760, hangulTargetCenter: 500 })
  })

  test('learns how large the medial and final are written relative to the initial', () => {
    // Initial and final ㄹ with the same 40×20 centerline box, ㅡ 100 long.
    const rieul = (prefix: string, y: number) => [
      penStroke(`${prefix}1`, 50, y, [[0, 0], [40, 0], [40, 10]]),
      penStroke(`${prefix}2`, 50, y + 10, [[40, 0], [0, 0], [0, 10]]),
      penStroke(`${prefix}3`, 50, y + 20, [[0, 0], [40, 0]]),
    ]
    const { session } = sessionWriting('를', [rieul('i', 20), [penStroke('eu', 20, 60, [[0, 0], [100, 0]])], rieul('f', 90)])
    const profile = learnProportions({ [session.exerciseId]: session })
    expect(profile.syllables['를'].final).toBeCloseTo(1, 5)
    expect(profile.contexts['horizontalDown:final'].final).toBeCloseTo(1, 5)
    expect(profile.contexts['horizontalDown:final'].medial).toBeCloseTo(100 / Math.sqrt(800), 5)
  })
})

test('the writing sentences collect every required prompt', () => {
  const collected = new Set(WRITING_EXERCISES.flatMap((exercise) => exercise.cells.flatMap((cell) => cell.slots.map((slot) => slot.promptId))))
  // Standalone consonants and vowels are taken from the contextual jamo, not written on their own.
  const written = REQUIRED_PROMPTS.filter((prompt) => prompt.group !== 'consonant' && prompt.group !== 'vowel')
  expect(written.filter((prompt) => !collected.has(prompt.id)).map((prompt) => prompt.id)).toEqual([])
})
