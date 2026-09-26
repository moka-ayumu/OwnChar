import type { HangulRole, WritingSessionRecord } from '@/types/project'
import type { GapKind } from './gap-profile'
import { completedHangulCells } from './hangul-samples'
import { jamoSize, proportionContext, proportionPair, type ProportionProfile, type RoleRatios } from './proportion-profile'
import type { RawStroke } from './stroke-outline'

export type { ProportionProfile } from './proportion-profile'

const roles: HangulRole[] = ['initial', 'medial', 'final']

function centerlineBox(strokes: RawStroke[]) {
  const points = strokes.flatMap((stroke) => stroke.points.map(([x, y]) => [stroke.x + x, stroke.y + y] as const))
  if (!points.length) return null
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

function gapKind(char: string): GapKind {
  const vowel = Math.floor(((char.codePointAt(0)! - 0xac00) % 588) / 28)
  return new Set([0, 1, 2, 3, 4, 5, 6, 7, 20]).has(vowel) ? 'vertical'
    : new Set([8, 12]).has(vowel) ? 'horizontalUp'
      : new Set([13, 17, 18]).has(vowel) ? 'horizontalDown' : 'mixed'
}

function average(values: number[]) {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0
  const retained = sorted.slice(trim, sorted.length - trim)
  return retained.reduce((sum, value) => sum + value, 0) / retained.length
}

type Samples = { medial: number[]; final: number[] }

function summarize(groups: Map<string, Samples>): Record<string, RoleRatios> {
  return Object.fromEntries([...groups].map(([key, samples]) => [key, {
    medial: average(samples.medial),
    final: average(samples.final),
    sampleCount: Math.max(samples.medial.length, samples.final.length),
  }]))
}

/** Learn how large the user writes medial and final jamo relative to the initial. */
export function learnProportions(sessions: Record<string, WritingSessionRecord>): ProportionProfile {
  const contexts = new Map<string, Samples>()
  const pairs = new Map<string, Samples>()
  const syllables = new Map<string, Samples>()
  const add = (map: Map<string, Samples>, key: string, role: 'medial' | 'final', value: number) => {
    const samples = map.get(key) ?? { medial: [], final: [] }
    samples[role].push(value)
    map.set(key, samples)
  }
  for (const { cell, assigned } of completedHangulCells(sessions)) {
    const kind = gapKind(cell.char)
    const boxes = assigned.map(centerlineBox)
    if (boxes.some((box) => !box)) continue
    const sizes = boxes.map((box, index) => jamoSize(roles[index], kind, box!.width, box!.height))
    const initial = sizes[0]
    if (initial < 1) continue
    const hasFinal = cell.slots.length > 2
    const keys: Array<[Map<string, Samples>, string]> = [
      [contexts, proportionContext(kind, hasFinal)],
      [pairs, proportionPair(cell.slots[0].char, cell.slots[1].char, cell.slots[2]?.char)],
      [syllables, cell.char],
    ]
    for (const [map, key] of keys) {
      add(map, key, 'medial', sizes[1] / initial)
      if (hasFinal) add(map, key, 'final', sizes[2] / initial)
    }
  }
  return { contexts: summarize(contexts), pairs: summarize(pairs), syllables: summarize(syllables) }
}
