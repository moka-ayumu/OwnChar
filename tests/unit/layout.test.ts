import opentype from 'opentype.js'
import { describe, expect, test } from 'vitest'
import { hasInkClearance, inkIntersectionArea } from '@/font/geometry/collision'
import { appendShape, combineShapesSideBySide, type NormalizedShape } from '@/font/geometry/shape'
import { composeStandaloneJamoPath } from '@/font/glyphs/standalone-jamo'
import { appendNumeral } from '@/font/glyphs/symbols'
import { composeHangulParts } from '@/font/layout/compose-syllable'
import { selectJamoSource, sourceKey } from '@/font/layout/source-selection'
import { DEFAULT_GAPS, minimumGap, type GapProfile } from '@/font/layout/gap-profile'
import { finalBoxGap } from '@/font/layout/overlap-policy'
import { layoutSyllable, medialSpace } from '@/font/layout/syllable-layout'
import { DEFAULT_COMPOSITION_SETTINGS } from '@/font/settings'
import { composedHangulParts, composedHangulPath, composeFont, precomposeHangulRange } from '@/generation/font-builder'
import { boxOf, CELL, centerOf, contourBoxes, isFinite, penStroke, shapeOf, unlearned } from './helpers'

const compose = (char: string, shapes: Map<string, NormalizedShape>, options = {}) => composeHangulParts(char.codePointAt(0)!, shapes, DEFAULT_COMPOSITION_SETTINGS, options)

// Jamo written one per cell, so nothing ties their positions together.
const bar = (id: string) => shapeOf([penStroke(id, 10, 74, [[0, 0], [128, 0]])])
const smallNieun = () => shapeOf([penStroke('n', 60, 60, [[0, 0], [0, 20], [25, 20]])])
/** ㄷ: open to the right. */
const digeut = () => shapeOf([penStroke('d1', 30, 40, [[55, 0], [0, 0], [0, 60], [55, 60]])])
/** ㄱ: closed to the right. */
const giyeok = () => shapeOf([penStroke('g1', 30, 40, [[0, 0], [55, 0], [55, 60]])])
/** ㅓ: a stem with an arm reaching left. */
const eo = () => shapeOf([penStroke('eo1', 110, 15, [[0, 0], [0, 110]]), penStroke('eo2', 80, 70, [[0, 0], [30, 0]])])
/** ㅜ: a bar with a stem reaching down. */
const u = () => shapeOf([penStroke('u1', 20, 60, [[0, 0], [108, 0]]), penStroke('u2', 74, 60, [[0, 0], [0, 45]])])

describe('syllable layout', () => {
  test('every jamo of a syllable, and a numeral, is drawn with the same pen however much it was resized', () => {
    // Jamo written at very different sizes: rescaling their outlines would
    // make the small ㄴ thick and the long ㅡ thin.
    const { parts } = compose('느', new Map([['ㄴ', smallNieun()], ['ㅡ', bar('eu')]]))
    const medial = contourBoxes(parts.medial)[0]
    const initial = contourBoxes(parts.initial)[0]
    const medialPen = medial.y2 - medial.y1
    // Above the corner only ㄴ's vertical leg has ink: its width is the pen.
    const legXs = parts.initial.commands.flatMap((command) => 'x' in command && command.y > (initial.y1 + initial.y2) / 2 ? [command.x] : [])
    expect((Math.max(...legXs) - Math.min(...legXs)) / medialPen).toBeCloseTo(1, 1)

    const numeral = (strokeWidth: number) => {
      const path = new opentype.Path()
      appendNumeral(path, shapeOf([penStroke('one', 74, 20, [[0, 0], [0, 110]], strokeWidth)]))
      const [box] = contourBoxes(path)
      return box.x2 - box.x1
    }
    expect(numeral(1) / medialPen).toBeCloseTo(1, 1)
    // A stroke written with a pen twice as wide stays twice as wide.
    expect(numeral(2) / numeral(1)).toBeCloseTo(2, 1)
  })

  test('follows the learned initial : final size ratio, within what the space allows', () => {
    const shapes = new Map([
      ['ㄴ', smallNieun()],
      ['ㅡ', bar('eu')],
      ['ㄹ', shapeOf([
        penStroke('r1', 20, 20, [[0, 0], [100, 0], [100, 50]]),
        penStroke('r2', 20, 70, [[100, 0], [0, 0], [0, 50]]),
        penStroke('r3', 20, 120, [[0, 0], [100, 0]]),
      ])],
    ])
    const ratio = (finalRatio?: number) => {
      const proportions = { contexts: finalRatio === undefined ? {} : { 'horizontalDown:final': { final: finalRatio, sampleCount: 4 } }, pairs: {}, syllables: {} }
      const { parts } = compose('늘', shapes, { proportions })
      // ㅡ is one horizontal stroke: its height is the pen.
      const pen = contourBoxes(parts.medial)[0].y2 - contourBoxes(parts.medial)[0].y1
      const size = (path: opentype.Path) => Math.sqrt((boxOf(path).x2 - boxOf(path).x1 - pen) * (boxOf(path).y2 - boxOf(path).y1 - pen))
      return size(parts.final) / size(parts.initial)
    }
    const unlearnedRatio = ratio()
    expect(Math.abs(unlearnedRatio - 0.6)).toBeGreaterThan(0.2)
    expect(ratio(0.6) / 0.6).toBeCloseTo(1, 1)
    expect(ratio(4)).toBeLessThan(2)
  })

  test('jamo written together keep their arrangement under one scale, and a final from elsewhere is centred below them', () => {
    const initial = shapeOf([penStroke('i', 25, 40, [[0, 0], [20, 0], [20, 35]])], 'captured')
    const medial = shapeOf([penStroke('m', 80, 15, [[0, 0], [0, 45], [20, 45]])], 'captured')
    const final = shapeOf([penStroke('f', 10, 100, [[0, 0], [35, 0], [35, 20]])], 'other')
    const result = compose('각', new Map([[sourceKey('initial', 5, 'ㄱ'), initial], [sourceKey('medial', 1, 'ㅏ'), medial], [sourceKey('final', 0, 'ㄱ'), final]]))
    expect(result.geometry.scales.initial).toBeCloseTo(result.geometry.scales.medial!, 9)
    const native = [initial, medial].map((shape) => {
      const path = new opentype.Path()
      appendShape(path, shape, { x: 0, y: 0, width: 1000, height: 1000 }, true)
      return centerOf(path)
    })
    const placed = [centerOf(result.parts.initial), centerOf(result.parts.medial)]
    const sx = (placed[1].x - placed[0].x) / (native[1].x - native[0].x)
    const sy = (placed[1].y - placed[0].y) / (native[1].y - native[0].y)
    expect(sx / sy).toBeCloseTo(1, 1)
    const upper = [boxOf(result.parts.initial), boxOf(result.parts.medial)]
    expect(centerOf(result.parts.final).x).toBeCloseTo((Math.min(...upper.map((b) => b.x1)) + Math.max(...upper.map((b) => b.x2))) / 2, 5)
  })

  test('jamo written together are separated when their ink would cross', () => {
    const left = shapeOf([penStroke('left', 40, 20, [[0, 0], [20, 40]])], 'crossing')
    const right = shapeOf([penStroke('right', 40, 20, [[20, 0], [0, 40]])], 'crossing')
    const result = compose('가', new Map([[sourceKey('initial', 0, 'ㄱ'), left], [sourceKey('medial', 0, 'ㅏ'), right]]))
    expect(result.geometry.groups.initial).not.toBe(result.geometry.groups.medial)
    expect(inkIntersectionArea(result.parts.initial, result.parts.medial)).toBe(0)
  })

  test('a vowel arm enters an initial that is open toward it, and only then', () => {
    const shapes = new Map([['ㄷ', digeut()], ['ㄱ', giyeok()], ['ㅓ', eo()], ['ㅐ', eo()]])
    const gap = (char: string) => {
      const { parts } = compose(char, shapes)
      expect(inkIntersectionArea(parts.initial, parts.medial), char).toBe(0)
      return boxOf(parts.medial).x1 - boxOf(parts.initial).x2
    }
    expect(gap('더')).toBeLessThan(0)
    // ㅐ has no arm, and ㄱ has no opening.
    expect(gap('대')).toBeGreaterThan(0)
    expect(gap('거')).toBeGreaterThan(0)
  })

  test('a vowel stem enters a final that is open at the top; any other final stays below, centred', () => {
    const openTop = shapeOf([penStroke('n', 20, 100, [[0, 0], [0, 30], [100, 30]])])
    const closedTop = shapeOf([penStroke('g', 20, 100, [[0, 0], [100, 0], [100, 30]])])
    const shapes = new Map([['ㄴ', smallNieun()], ['ㄱ', giyeok()], ['ㅜ', u()], [sourceKey('final', 0, 'ㄴ'), openTop], [sourceKey('final', 0, 'ㄱ'), closedTop]])
    const measure = (char: string) => {
      const { parts } = compose(char, shapes)
      const upper = new opentype.Path()
      upper.commands.push(...parts.initial.commands, ...parts.medial.commands)
      return {
        gap: boxOf(upper).y1 - boxOf(parts.final).y2,
        crossing: inkIntersectionArea(upper, parts.final),
        offCentre: Math.abs(centerOf(upper).x - centerOf(parts.final).x),
      }
    }
    expect(measure('눈').gap).toBeLessThan(0)
    // The stem goes in no further than the gap it would otherwise keep.
    const placed = layoutSyllable({ codePoint: '눈'.codePointAt(0)!, shapes, penScale: 1 }).parts
    expect(Math.min(boxOf(placed.initial).y1, boxOf(placed.medial).y1) - boxOf(placed.final).y2).toBeGreaterThanOrEqual(-minimumGap - 1e-6)
    expect(measure('눈').crossing).toBe(0)
    expect(measure('국').gap).toBeGreaterThanOrEqual(0)
    expect(measure('국').offCentre).toBeLessThan(1)
  })

  test('only ㄴ and ㅂ interlock with a downward stem; every other final keeps its box below the upper body', () => {
    expect(finalBoxGap('ㅜ', 'ㄴ')).toBe(-minimumGap)
    expect(finalBoxGap('ㅞ', 'ㅂ')).toBe(-minimumGap)
    // Two consonants side by side may come up to the stem, not around it.
    expect(finalBoxGap('ㅟ', 'ㅄ')).toBe(0)
    expect(finalBoxGap('ㅜ', 'ㄲ')).toBe(0)
    expect(finalBoxGap('ㅠ', 'ㄱ')).toBe(minimumGap)
    expect(finalBoxGap('ㅙ', 'ㄶ')).toBe(minimumGap)
    expect(finalBoxGap('ㅗ', 'ㄴ')).toBe(minimumGap)

    const closedTop = () => shapeOf([penStroke('g', 20, 100, [[0, 0], [100, 0], [100, 30]])])
    // ㅙ whose stems reach below its ㅗ.
    const wae = shapeOf([
      penStroke('o1', 10, 100, [[0, 0], [70, 0]]), penStroke('o2', 45, 80, [[0, 0], [0, 20]]),
      penStroke('a1', 108, 20, [[0, 0], [0, 110]]), penStroke('a2', 108, 65, [[0, 0], [25, 0]]), penStroke('a3', 133, 20, [[0, 0], [0, 110]]),
    ])
    const shapes = new Map([
      ['ㄱ', giyeok()], ['ㅜ', u()], ['ㅙ', wae],
      [sourceKey('final', 0, 'ㄱ'), closedTop()], [sourceKey('final', 0, 'ㄲ'), closedTop()], [sourceKey('final', 0, 'ㄶ'), closedTop()],
    ])
    // A writer whose samples pull the final far into the vowel.
    const learned = { advanceGap: -80, crossOffset: 0, sampleCount: 4 }
    const gaps = { ...DEFAULT_GAPS, final: -80, medialFinalPairs: { 'ㅜ:ㄱ': learned, 'ㅜ:ㄲ': learned, 'ㅙ:ㄶ': learned } }
    const gap = (char: string, profile?: GapProfile) => {
      const { parts } = layoutSyllable({ codePoint: char.codePointAt(0)!, shapes, penScale: 1, gaps: profile })
      const upper = new opentype.Path()
      upper.commands.push(...parts.initial.commands, ...parts.medial.commands)
      return boxOf(upper).y1 - boxOf(parts.final).y2
    }
    console.log(['괞', '국', '굮'].map((c) => [c, gap(c), gap(c, gaps)]))
    for (const profile of [undefined, gaps]) {
      expect(gap('괞', profile)).toBeGreaterThanOrEqual(minimumGap - 1e-6)
      expect(gap('국', profile)).toBeGreaterThanOrEqual(minimumGap - 1e-6)
      expect(gap('굮', profile)).toBeGreaterThanOrEqual(-1e-6)
    }
    expect(gap('굮', gaps)).toBeLessThan(minimumGap)
  })

  test('a vowel stem entering the initial keeps the regular gap, and the final follows the vowel up', () => {
    /** ㅛ: a bar with two stems reaching up. */
    const yo = () => shapeOf([penStroke('yo1', 10, 90, [[0, 0], [128, 0]]), penStroke('yo2', 50, 60, [[0, 0], [0, 30]]), penStroke('yo3', 90, 60, [[0, 0], [0, 30]])])
    /** ㅁ: closed at the bottom. */
    const mieum = () => shapeOf([penStroke('m1', 30, 40, [[0, 0], [55, 0], [55, 60], [0, 60], [0, 0]])])
    const wideGiyeok = () => shapeOf([penStroke('wg', 10, 40, [[0, 0], [128, 0], [128, 40]])])
    const shapes = new Map([[sourceKey('initial', 0, 'ㄱ'), wideGiyeok()], ['ㅁ', mieum()], ['ㅛ', yo()], [sourceKey('final', 0, 'ㄱ'), giyeok()]])
    const measure = (char: string) => {
      const { parts } = layoutSyllable({ codePoint: char.codePointAt(0)!, shapes, penScale: 1 })
      return {
        parts,
        upperGap: boxOf(parts.initial).y1 - boxOf(parts.medial).y2,
        finalGap: boxOf(parts.medial).y1 - boxOf(parts.final).y2,
      }
    }
    const entered = measure('굑')
    expect(entered.upperGap).toBeLessThan(0)
    expect(hasInkClearance(entered.parts.initial, entered.parts.medial, minimumGap - 1)).toBe(true)
    expect(measure('교').upperGap).toBeLessThan(0)
    // However far the vowel went into the initial, the final stays as close as under a closed one.
    expect(entered.finalGap).toBeCloseTo(measure('묙').finalGap, 5)
  })

  test('a compound final built from parts stays within 90% of the upper body by narrowing its wider part', () => {
    /** ㅏ: a stem with an arm reaching right. */
    const a = () => shapeOf([penStroke('a1', 90, 15, [[0, 0], [0, 110]]), penStroke('a2', 90, 70, [[0, 0], [30, 0]])])
    const wideNieun = () => shapeOf([penStroke('wn', 10, 60, [[0, 0], [0, 30], [128, 30]])])
    const narrow = () => shapeOf([penStroke('h', 60, 60, [[0, 0], [20, 30]])])
    const shapes = new Map([
      ['ㄱ', giyeok()], ['ㅏ', a()],
      [sourceKey('final', 0, 'ㄴ'), wideNieun()], [sourceKey('final', 0, 'ㅎ'), narrow()],
      [sourceKey('final', 0, 'ㄶ'), { ...combineShapesSideBySide(wideNieun(), narrow()), sourceRole: 'final' as const }],
    ])
    const { parts } = layoutSyllable({ codePoint: '갆'.codePointAt(0)!, shapes, penScale: 1 })
    const i = boxOf(parts.initial); const m = boxOf(parts.medial); const f = boxOf(parts.final)
    expect(f.x2 - f.x1).toBeLessThanOrEqual((Math.max(i.x2, m.x2) - Math.min(i.x1, m.x1)) * 0.9 + 1)
    // Both parts keep one height: the narrow one was not shrunk to make room.
    const [left, right] = contourBoxes(parts.final)
    expect((right.y2 - right.y1) / (left.y2 - left.y1)).toBeCloseTo(1, 1)
    expect(right.x2 - right.x1).toBeLessThan(left.x2 - left.x1)
  })

  test('with a compound vowel, the initial sits in its left compartment and the final under the whole vowel', () => {
    // ㅙ: ㅗ on the left, then two stems joined by a short bar.
    const medial = shapeOf([
      penStroke('o1', 10, 100, [[0, 0], [70, 0]]), penStroke('o2', 45, 80, [[0, 0], [0, 20]]),
      penStroke('a1', 108, 20, [[0, 0], [0, 100]]), penStroke('a2', 108, 65, [[0, 0], [25, 0]]), penStroke('a3', 133, 20, [[0, 0], [0, 100]]),
    ])
    const consonant = () => shapeOf([penStroke('c', 40, 40, [[0, 0], [50, 0], [50, 35], [0, 35], [0, 0]])])
    const { parts } = compose('뢥', new Map([['ㄹ', consonant()], ['ㅙ', medial], ['ㅂ', consonant()]]))
    const space = medialSpace(parts.medial)!
    expect(space.horizontal.x2).toBeLessThan(space.vertical.x1)
    const i = boxOf(parts.initial); const m = boxOf(parts.medial)
    expect(centerOf(parts.initial).x).toBeLessThan(space.vertical.x1)
    expect(i.y1).toBeGreaterThan(space.horizontal.y2)
    expect(i.y2 - m.y2).toBeLessThan((m.y2 - m.y1) * 0.45)
    expect(centerOf(parts.final).x).toBeCloseTo(centerOf(parts.medial).x, 5)
  })

  test('a long stem under ㅜ stays in the left compartment, and the initial stays inside it', () => {
    // ㅟ whose ㅜ stem is right of centre and about half as tall as ㅣ.
    const wi = () => shapeOf([
      penStroke('u1', 20, 70, [[0, 0], [60, 0]]), penStroke('u2', 55, 70, [[0, 0], [0, 65]]),
      penStroke('i1', 100, 5, [[0, 0], [0, 135]]),
    ])
    const { parts } = compose('뉘', new Map([['ㄴ', smallNieun()], ['ㅟ', wi()]]))
    const space = medialSpace(parts.medial)!
    const [, hanging, main] = contourBoxes(parts.medial)
    expect(space.vertical.x1).toBeCloseTo(main.x1, 0)
    expect(space.horizontal.y1).toBeCloseTo(hanging.y1, 0)
    expect(centerOf(parts.initial).x).toBeGreaterThan(boxOf(parts.medial).x1)
    expect(boxOf(parts.initial).x2).toBeLessThan(space.vertical.x1)
  })

  test('uses the same jamo from the nearest other layout before one written in another role', () => {
    const sources = new Map([
      [sourceKey('initial', 1, 'ㄴ'), { sourceRole: 'initial' as const }],
      [sourceKey('initial', 6, 'ㄴ'), { sourceRole: 'initial' as const }],
      ['ㄴ', { sourceRole: 'final' as const }],
    ])
    expect(selectJamoSource(sources, 'initial', 1, 'ㄴ')?.match).toBe('exact')
    expect(selectJamoSource(sources, 'initial', 2, 'ㄴ')?.key).toBe(sourceKey('initial', 1, 'ㄴ'))
    expect(selectJamoSource(new Map([['ㄴ', { sourceRole: 'final' as const }]]), 'initial', 0, 'ㄴ')?.match).toBe('cross-role')
  })
})

describe('composition with missing sources', () => {
  test('roles without a source are reserved as finite placeholders and carry no ink', () => {
    const result = compose('괌', new Map(), { placeholderRoles: ['initial', 'medial', 'final'] })
    expect(result.path.commands).toHaveLength(0)
    expect(Object.keys(result.placeholders)).toHaveLength(3)
    for (const box of Object.values(result.placeholders)) expect(Object.values(box).every(Number.isFinite)).toBe(true)

    const onlyInitial = shapeOf([penStroke('partial', 20, 30, [[0, 0], [40, 0], [40, 35]])], 'elsewhere')
    for (const [char, variant] of [['각', 5], ['괌', 7], ['굵', 6]] as const) {
      const partial = compose(char, new Map([[sourceKey('initial', variant, 'ㄱ'), onlyInitial]]))
      expect(partial.parts.initial.commands.length).toBeGreaterThan(0)
      expect(isFinite(partial.path)).toBe(true)
    }
  })

  test('a syllable whose initial was never written is exported with the ink it has, the same in preview and font', async () => {
    const medial = shapeOf([penStroke('m', 100, 20, [[0, 0], [0, 45], [20, 45]])], 'partial-cell')
    const final = shapeOf([penStroke('f', 30, 110, [[0, 0], [50, 0], [50, 20]])], 'partial-cell')
    const shapes = new Map([[sourceKey('medial', 1, 'ㅏ'), medial], [sourceKey('final', 0, 'ㄱ'), final]])
    const codePoint = '낙'.codePointAt(0)!
    const result = composedHangulParts(codePoint, shapes, unlearned, 1)
    expect(result.parts.initial.commands).toHaveLength(0)
    expect(result.parts.medial.commands.length).toBeGreaterThan(0)
    expect(result.parts.final.commands.length).toBeGreaterThan(0)
    expect(result.geometry.groups.medial).toBe(result.geometry.groups.final)
    expect(isFinite(result.path)).toBe(true)
    expect(composedHangulPath(codePoint, shapes, unlearned, 1).commands).toEqual(result.path.commands)

    const request = { ...unlearned, type: 'compose-font' as const, drawings: {}, metadata: { familyName: 'Partial', styleName: 'Regular', designer: '', version: '1.0' }, overrides: {}, globalMetrics: { left: 0, right: 0, y: 0 } }
    const offset = codePoint - 0xac00
    const [record] = await precomposeHangulRange(request, offset, offset + 1, undefined, { shapes, visualScale: 1 })
    expect(record.commands).toEqual(result.path.commands)
  })
})

describe('standalone glyphs', () => {
  test('a wide jamo is fitted to both dimensions of the 가 envelope', () => {
    const path = composeStandaloneJamoPath(bar('wide'), DEFAULT_COMPOSITION_SETTINGS, { width: 420, height: 760, centerX: 500, centerY: 500 })
    expect(boxOf(path).x2 - boxOf(path).x1).toBeLessThanOrEqual(420.01)
    expect(boxOf(path).y2 - boxOf(path).y1).toBeLessThan(100)
  })

  test('numerals get the height and baseline of ! whatever their width', async () => {
    const drawing = (...strokes: ReturnType<typeof penStroke>[]) => ({ elements: strokes, cellSize: CELL, sourceCellId: 'numbers-symbols:0' })
    const request = {
      ...unlearned, type: 'compose-font' as const,
      drawings: {
        [`symbol-${'!'.codePointAt(0)}`]: drawing(penStroke('bang', 74, 20, [[0, 0], [0, 80]]), penStroke('dot', 74, 120, [[0, 0], [0.5, 0]])),
        [`number-${'1'.codePointAt(0)}`]: drawing(penStroke('one', 74, 10, [[0, 0], [0, 128]])),
        [`number-${'4'.codePointAt(0)}`]: drawing(penStroke('four', 40, 30, [[40, 0], [0, 60], [60, 60]]), penStroke('four2', 80, 50, [[0, 0], [0, 70]])),
      },
      metadata: { familyName: 'T', styleName: 'Regular', designer: '', version: '1.0' },
      overrides: {}, globalMetrics: { left: 0, right: 0, y: 0 },
    }
    // The syllables are not under test: hand the builder empty outlines for all of them.
    const precomposedHangul = new Map(Array.from({ length: 11_172 }, (_, index) => [0xac00 + index, []]))
    const { buffer, glyphCount } = await composeFont(request, { cancelled: () => false, progress: () => {}, precomposedHangul })
    const font = opentype.parse(buffer)
    const box = (char: string) => font.charToGlyph(char).getBoundingBox()
    for (const digit of ['1', '4']) {
      expect((box(digit).y2 - box(digit).y1) / (box('!').y2 - box('!').y1)).toBeCloseTo(1, 1)
      expect(box(digit).y1).toBeCloseTo(box('!').y1, 0)
    }
    // Every syllable and base character has a glyph; symbols that were not written do not.
    expect(glyphCount).toBeGreaterThan(11_172)
    expect(font.charToGlyph('가').advanceWidth).toBe(1000)
    expect(font.charToGlyph('A').advanceWidth).toBe(680)
    expect(font.charToGlyph('?').index).toBe(0)
  })
})
