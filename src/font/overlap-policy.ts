import opentype from 'opentype.js'

export type OverlapBoundary = 'initial-medial' | 'medial-final'
export type NotchType = 'RIGHT_NOTCH' | 'BOTTOM_CENTER_NOTCH' | 'BOTTOM_TWO_NOTCHES' | 'TOP_CENTER_NOTCH' | 'TOP_OFFSET_NOTCH'

export interface OverlapRuleDescriptor {
  id: string
  boundary: OverlapBoundary
  notch: NotchType
  first: readonly string[]
  second: readonly string[] | '*'
  axis: 'x' | 'y'
  direction: -1 | 1
  conditional: boolean
}

const TOP_FINALS = [...'ㄲㄳㄴㄵㄶㄺㄻㄼㄽㄾㄿㅀㅂㅄㅆ']

export const OVERLAP_RULES: readonly OverlapRuleDescriptor[] = [
  {
    id: 'initial-right-notch', boundary: 'initial-medial', notch: 'RIGHT_NOTCH',
    first: [...'ㄴㄷㄸㄹㅅㅆㅈㅉㅊㅌㅍ'], second: [...'ㅓㅕㅔㅖ'], axis: 'x', direction: -1, conditional: false,
  },
  {
    id: 'initial-bottom-center', boundary: 'initial-medial', notch: 'BOTTOM_CENTER_NOTCH',
    first: [...'ㄱㄲㄸㅃㅅㅆㅈㅉㅊㅋ'], second: [...'ㅗㅘㅙㅚ'], axis: 'y', direction: 1, conditional: false,
  },
  {
    id: 'initial-bottom-two', boundary: 'initial-medial', notch: 'BOTTOM_TWO_NOTCHES',
    first: [...'ㄱㄲㅅㅆㅈㅉㅊㅋ'], second: ['ㅛ'], axis: 'y', direction: 1, conditional: false,
  },
  {
    id: 'final-top-center', boundary: 'medial-final', notch: 'TOP_CENTER_NOTCH',
    first: ['ㅜ'], second: TOP_FINALS, axis: 'y', direction: 1, conditional: false,
  },
  {
    id: 'final-top-offset', boundary: 'medial-final', notch: 'TOP_OFFSET_NOTCH',
    first: [...'ㅝㅞㅟ'], second: TOP_FINALS, axis: 'y', direction: 1, conditional: true,
  },
  {
    id: 'final-two-stems', boundary: 'medial-final', notch: 'BOTTOM_TWO_NOTCHES',
    first: ['ㅠ'], second: '*', axis: 'y', direction: 1, conditional: true,
  },
]

export function expandOverlapPairs(boundary: OverlapBoundary, conditional: boolean) {
  return OVERLAP_RULES.filter((rule) => rule.boundary === boundary && rule.conditional === conditional && rule.second !== '*')
    .flatMap((rule) => rule.first.flatMap((first) => rule.second === '*' ? [] : rule.second.map((second) => `${first}:${second}`)))
}

export const OVERLAP_POLICY_COUNTS = {
  confirmedInitialMedial: expandOverlapPairs('initial-medial', false).length,
  confirmedMedialFinal: expandOverlapPairs('medial-final', false).length,
  conditionalMedialFinal: expandOverlapPairs('medial-final', true).length,
} as const

export function overlapRule(boundary: OverlapBoundary, first: string, second: string) {
  return OVERLAP_RULES.find((rule) => rule.boundary === boundary && rule.first.includes(first) && (rule.second === '*' || rule.second.includes(second)))
}

function commandPoints(path: opentype.Path) {
  return (path.commands as Array<Record<string, unknown>>).flatMap((command) => {
    const points: Array<[number, number]> = []
    for (const [xKey, yKey] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (typeof command[xKey] === 'number' && typeof command[yKey] === 'number') points.push([command[xKey] as number, command[yKey] as number])
    }
    return points
  })
}

/** Conditional rules must describe the expected protrusion before the generic solver runs. */
export function conditionalGeometryAllows(rule: OverlapRuleDescriptor, medial: opentype.Path, diameter: number) {
  if (!rule.conditional) return true
  const box = medial.getBoundingBox()
  const points = commandPoints(medial)
  if (!points.length) return false
  const lower = points.filter(([, y]) => y <= box.y1 + (box.y2 - box.y1) * 0.55).map(([x]) => x).sort((a, b) => a - b)
  if (!lower.length) return false
  if (rule.id !== 'final-two-stems') {
    // ㅝ/ㅞ/ㅟ: an offset downward stem must actually be present.
    const center = (box.x1 + box.x2) / 2
    return lower.some((x) => Math.abs(x - center) > diameter)
  }
  // ㅠ: both separated downward stems must survive outline construction.
  const clusters: number[][] = []
  for (const x of lower) {
    const current = clusters.at(-1)
    if (!current || x - current.at(-1)! > diameter * 1.25) clusters.push([x])
    else current.push(x)
  }
  return clusters.length >= 2
}
