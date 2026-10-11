import { describe, expect, test } from 'vitest'
import type { NormalizedShape } from '@/font/geometry/shape'
import { composeCellGuide, composeGuideParts, type CellGuideInput } from '@/font/guides'
import type { HangulRole } from '@/font/hangul'
import { sourceKey } from '@/font/layout/source-selection'
import { DEFAULT_COMPOSITION_SETTINGS } from '@/font/settings'
import { penStroke, shapeOf } from './helpers'

const line = () => shapeOf([penStroke('line', 10, 74, [[0, 0], [128, 0]])])
const tall = () => shapeOf([penStroke('tall', 50, 10, [[0, 0], [40, 0], [40, 120]])])
const small = () => shapeOf([penStroke('small', 40, 40, [[0, 0], [30, 0], [30, 50]])])

function guideInput(char: string, roles: HangulRole[], shapes: Map<string, NormalizedShape>): CellGuideInput {
  return {
    codePoint: char.codePointAt(0)!, cellId: 'writing:0', writtenRoles: [], shapes, settings: DEFAULT_COMPOSITION_SETTINGS, options: {},
    guideRoles: Object.fromEntries(roles.map((role) => [role, `${role}-source`])),
  }
}

describe('cell guides', () => {
  test('a guide is shown inside the cell and stays as stored', () => {
    const shapes = new Map([['ㅡ', line()], ['ㄹ', tall()], ['ㅐ', tall()]])
    for (const [char, roles] of [['끓', ['medial']], ['래', ['initial', 'medial']]] as const) {
      const input = guideInput(char, [...roles], shapes)
      const guide = composeCellGuide(input)
      for (const box of [...Object.values(guide.roles).map((entry) => entry.box), ...Object.values(guide.placeholders)]) {
        expect(Math.min(box.x1, box.y1)).toBeGreaterThanOrEqual(0)
        expect(Math.max(box.x2, box.y2)).toBeLessThanOrEqual(1000)
      }
      // Every role still to be written has a place, and a band to write in that contains it.
      expect(Object.keys(guide.placeholders).length + roles.length).toBe(char === '끓' ? 3 : 2)
      for (const [role, place] of Object.entries(guide.placeholders)) {
        const band = guide.bands[role as HangulRole]!
        expect(band.x1 <= place.x1 && band.x2 >= place.x2 && band.y1 <= place.y1 && band.y2 >= place.y2).toBe(true)
      }
      expect(composeCellGuide({ ...input, stored: guide })).toEqual(guide)
    }
  })

  test('a guide is not sized against jamo that are not written yet', () => {
    const input = guideInput('끓', ['medial'], new Map([['ㅡ', line()]]))
    const expected = composeCellGuide(input)
    const ratios = { medial: 0.3, final: 0.4, sampleCount: 1 }
    // Stand-ins for the unwritten roles, and learned ratios against them, must not shrink the guide.
    for (const donor of [tall(), line()]) {
      const guide = composeCellGuide({
        ...input,
        shapes: new Map([['ㅡ', line()], ['ㄲ', donor], ['ㅀ', donor]]),
        options: { proportions: { contexts: { 'horizontalDown:final': ratios, 'horizontalUp:final': ratios }, pairs: {}, syllables: {} } },
      })
      expect(guide).toEqual(expected)
    }
    expect(expected.roles.medial!.box.x2 - expected.roles.medial!.box.x1).toBeGreaterThan(500)
  })

  test('a shown guide does not move when other jamo are rewritten or the missing jamo is written', () => {
    const input = guideInput('각', ['initial', 'medial'], new Map([['ㄱ', small()], ['ㅏ', small()]]))
    const shown = composeCellGuide(input)
    expect(Object.keys(shown.roles)).toEqual(['initial', 'medial'])
    const written = Object.assign(line(), { sourceCellId: 'writing:0' })
    const next = composeCellGuide({ ...input, stored: shown, writtenRoles: ['final'], shapes: new Map([['ㄱ', line()], ['ㅏ', line()], [sourceKey('final', 0, 'ㄱ'), written]]) })
    expect(next).toEqual(shown)
  })

  test('guide jamo are composed from sources outside the cell, so writing in the cell leaves them in place', () => {
    const shapes = new Map([
      [sourceKey('initial', 5, 'ㄱ'), shapeOf([penStroke('g', 20, 30, [[0, 0], [40, 0], [40, 50]])], 'a:0')],
      [sourceKey('medial', 1, 'ㅏ'), shapeOf([penStroke('a1', 100, 20, [[0, 0], [0, 80]]), penStroke('a2', 100, 55, [[0, 0], [20, 0]])], 'b:0')],
      ['ㄱ', shapeOf([penStroke('base', 40, 40, [[0, 0], [60, 0], [60, 60]])])],
    ])
    const codePoint = '각'.codePointAt(0)!
    const before = composeGuideParts(codePoint, shapes, DEFAULT_COMPOSITION_SETTINGS, {}, 'lock:0')
    const written = shapeOf([penStroke('final', 40, 110, [[0, 0], [60, 0], [60, 25]])], 'lock:0')
    const after = composeGuideParts(codePoint, new Map([...shapes, [sourceKey('final', 0, 'ㄱ'), written]]), DEFAULT_COMPOSITION_SETTINGS, {}, 'lock:0')
    expect(after.parts.initial.commands).toEqual(before.parts.initial.commands)
    expect(after.parts.medial.commands).toEqual(before.parts.medial.commands)
  })
})
