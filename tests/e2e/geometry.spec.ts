import { expect, test } from '@playwright/test'
import { conditionStroke, pressureResponse, stabilizeStrokePoints, strokeContours, strokeNeedsUnion, strokePolygon, strokeSvgPath, type RawStroke } from '../../src/font/stroke-outline'

test('stabilizes noisy stroke ends without mutating the captured centerline', () => {
  const points: [number, number][] = [
    [0, 4], [3, 1], [7, 0], [12, 0], [20, 0], [40, 0], [60, 0], [80, 0],
    [88, 0], [93, 0], [97, -1], [100, -4],
  ]
  const snapshot = structuredClone(points)
  const stabilized = stabilizeStrokePoints(points, 10)
  const spread = (values: [number, number][]) => Math.max(...values.map((point) => point[1])) - Math.min(...values.map((point) => point[1]))
  expect(points).toEqual(snapshot)
  expect(spread(stabilized.slice(0, 4))).toBeLessThanOrEqual(spread(points.slice(0, 4)) * 0.25)
  expect(spread(stabilized.slice(-4))).toBeLessThanOrEqual(spread(points.slice(-4)) * 0.25)
  expect(stabilized[6]).toEqual(points[6])
  expect(stabilizeStrokePoints([[0, 0], [4, 3], [8, 0]], 10)).toEqual([[0, 0], [4, 3], [8, 0]])
})

test('stabilizes sparse completed endpoints but leaves the live tail untouched', () => {
  const sparse: [number, number][] = [[0, 4], [10, 0], [40, 0], [90, 0], [100, -4]]
  const complete = stabilizeStrokePoints(sparse, 10, true)
  const live = stabilizeStrokePoints(sparse, 10, false)
  expect(Math.abs(complete[0][1])).toBeLessThanOrEqual(Math.abs(sparse[0][1]) * 0.25)
  expect(Math.abs(complete.at(-1)![1])).toBeLessThanOrEqual(Math.abs(sparse.at(-1)![1]) * 0.25)
  expect(live.at(-1)).toEqual(sparse.at(-1))
  expect(sparse).toEqual([[0, 4], [10, 0], [40, 0], [90, 0], [100, -4]])
})

test('preserves curved endpoints and scales only the accepted lateral correction', () => {
  const curve: [number, number][] = [[20, 0], [12, 1], [6, 5], [2, 12], [0, 20], [2, 28], [6, 35], [12, 39], [20, 40]]
  expect(conditionStroke(curve, curve.map(() => 1), 5, 'complete', 1).points).toEqual(curve)

  const line: [number, number][] = [[0, 2], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0]]
  const off = conditionStroke(line, line.map(() => 1), 5, 'complete', 0).points
  const half = conditionStroke(line, line.map(() => 1), 5, 'complete', 0.5).points
  const full = conditionStroke(line, line.map(() => 1), 5, 'complete', 1).points
  expect(off).toEqual(line)
  expect(half[0][1] - line[0][1]).toBeCloseTo((full[0][1] - line[0][1]) / 2, 6)
  expect(Math.hypot(full[0][0] - line[0][0], full[0][1] - line[0][1])).toBeLessThanOrEqual(2.001)
})

test('keeps the live start model fixed as the input prefix grows', () => {
  const points: [number, number][] = [[0, 3], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0], [60, 0], [70, 8]]
  const first = conditionStroke(points.slice(0, 6), points.slice(0, 6).map(() => 1), 5, 'live-start', 1).points
  const grown = conditionStroke(points, points.map(() => 1), 5, 'live-start', 1).points
  expect(Math.hypot(first[0][0] - grown[0][0], first[0][1] - grown[0][1])).toBeLessThan(0.25)
  expect(grown.at(-1)).toEqual(points.at(-1))
})

const line = (from: [number, number], to: [number, number], step = 2): [number, number][] => {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const count = Math.max(1, Math.round(length / step))
  return Array.from({ length: count + 1 }, (_, index) => [
    from[0] + (to[0] - from[0]) * index / count,
    from[1] + (to[1] - from[1]) * index / count,
  ] as [number, number])
}

test('straightens a contact hook that bends away from the stroke', () => {
  // Pen lands, skids down-left for ~7px, then writes a horizontal bar.
  const points: [number, number][] = [[6, -6], [4, -3], [2, 0], ...line([2, 0], [120, 0]).slice(1)]
  const result = conditionStroke(points, points.map(() => 1), 10, 'complete', 1).points
  for (const [, y] of result.slice(0, 4)) expect(Math.abs(y)).toBeLessThanOrEqual(1.5)
})

test('removes a release curl without backtracking along the stroke', () => {
  // Diagonal stroke that curls back and wobbles as the pen lifts (the blob in a "7").
  const body = line([0, 0], [80, 80])
  const points: [number, number][] = [...body, [83, 82], [85, 81], [84, 78], [82, 77], [81, 79]]
  const result = conditionStroke(points, points.map(() => 1), 10, 'complete', 1).points
  const tangent = [Math.SQRT1_2, Math.SQRT1_2]
  const along = result.map(([x, y]) => x * tangent[0] + y * tangent[1])
  const tail = along.slice(-12)
  for (let index = 1; index < tail.length; index += 1) expect(tail[index]).toBeGreaterThanOrEqual(tail[index - 1] - 1e-6)
  for (const [x, y] of result.slice(-5)) expect(Math.abs(x * tangent[1] - y * tangent[0])).toBeLessThan(1.5)
})

test('keeps intentional corners sharp while stabilizing', () => {
  const points: [number, number][] = [...line([0, 0], [100, 0]), ...line([100, 0], [100, 100]).slice(1)]
  const cornerIndex = points.findIndex(([x, y]) => x === 100 && y === 0)
  const result = conditionStroke(points, points.map(() => 1), 10, 'complete', 1).points
  expect(Math.hypot(result[cornerIndex][0] - 100, result[cornerIndex][1])).toBeLessThanOrEqual(1)
  const before = result[cornerIndex - 5]
  const after = result[cornerIndex + 5]
  const incoming = [result[cornerIndex][0] - before[0], result[cornerIndex][1] - before[1]]
  const outgoing = [after[0] - result[cornerIndex][0], after[1] - result[cornerIndex][1]]
  const angle = Math.acos((incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / (Math.hypot(incoming[0], incoming[1]) * Math.hypot(outgoing[0], outgoing[1])))
  expect(angle * 180 / Math.PI).toBeGreaterThanOrEqual(80)
})

test('smooths hand jitter in the stroke body and is inert at zero strength', () => {
  const points = line([0, 0], [200, 0]).map(([x], index) => [x, index % 2 ? 1 : -1] as [number, number])
  const rms = (values: [number, number][]) => Math.sqrt(values.slice(15, -15).reduce((sum, [, y]) => sum + y * y, 0) / (values.length - 30))
  const smoothed = conditionStroke(points, points.map(() => 1), 10, 'complete', 1).points
  expect(rms(smoothed)).toBeLessThanOrEqual(rms(points) * 0.5)
  expect(conditionStroke(points, points.map(() => 1), 10, 'complete', 0).points).toEqual(points)
})

test('expands the overlap policy to the documented pair counts', async () => {
  const server = await createModuleServer()
  try {
    const { OVERLAP_POLICY_COUNTS, OVERLAP_RULES, conditionalGeometryAllows, overlapRule } = await server.ssrLoadModule('/src/font/overlap-policy.ts')
    expect(OVERLAP_POLICY_COUNTS).toEqual({ confirmedInitialMedial: 92, confirmedMedialFinal: 15, conditionalMedialFinal: 45 })
    expect(overlapRule('initial-medial', 'ㄷ', 'ㅓ')?.conditional).toBe(false)
    expect(overlapRule('medial-final', 'ㅜ', 'ㅂ')?.conditional).toBe(false)
    expect(overlapRule('medial-final', 'ㅝ', 'ㄴ')?.conditional).toBe(true)
    expect(overlapRule('medial-final', 'ㅜ', 'ㄱ')).toBeUndefined()
    const twoStems = new opentype.Path()
    twoStems.moveTo(20, 0); twoStems.lineTo(30, 0); twoStems.lineTo(30, 60); twoStems.lineTo(20, 60); twoStems.close()
    twoStems.moveTo(70, 0); twoStems.lineTo(80, 0); twoStems.lineTo(80, 60); twoStems.lineTo(70, 60); twoStems.close()
    const oneStem = new opentype.Path()
    oneStem.moveTo(45, 0); oneStem.lineTo(55, 0); oneStem.lineTo(55, 60); oneStem.lineTo(45, 60); oneStem.close()
    const yuRule = OVERLAP_RULES.find((rule: { id: string }) => rule.id === 'final-two-stems')
    expect(conditionalGeometryAllows(yuRule, twoStems, 10)).toBe(true)
    expect(conditionalGeometryAllows(yuRule, oneStem, 10)).toBe(false)
  } finally {
    await server.close()
  }
})

test('detects a self crossing created by widening a tight noncrossing pen turn', () => {
  const points: [number, number][] = [[0, 0], [40, 0], [40, 8], [20, 8]]
  expect(Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1])).toBeGreaterThan(20)
  expect(strokeNeedsUnion(points, 10, points.map(() => 1))).toBe(true)
  expect(strokeContours(points, points.map(() => 1), 10).length).toBeGreaterThan(0)
})
import { selectJamoSource, sourceKey } from '../../src/font/source-selection'
import { createServer } from 'vite'
import opentype from 'opentype.js'
import { prepareCffPath } from '../../src/font/cff-outline'
import { maximizeSafeIntrusion, minimumInkDistance, outlinesIntersect } from '../../src/font/ink-collision'
import { composeStandaloneJamoPath } from '../../src/font/standalone-initial'
import { appendShape, normalizeRawStrokes, normalizeStrokePaths } from '../../src/font/path-geometry'
import { DEFAULT_COMPOSITION_SETTINGS } from '../../src/types/project'

const createModuleServer = () => createServer({
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
})

test('moves a protrusion into a cavity without outline collision', () => {
  const fixed = new opentype.Path()
  fixed.moveTo(0, 0); fixed.lineTo(20, 0); fixed.lineTo(20, 100); fixed.lineTo(0, 100); fixed.close()
  fixed.moveTo(20, 80); fixed.lineTo(100, 80); fixed.lineTo(100, 100); fixed.lineTo(20, 100); fixed.close()
  fixed.moveTo(20, 0); fixed.lineTo(100, 0); fixed.lineTo(100, 20); fixed.lineTo(20, 20); fixed.close()
  const moving = new opentype.Path()
  moving.moveTo(143, 45); moving.lineTo(223, 45); moving.lineTo(223, 55); moving.lineTo(143, 55); moving.close()
  moving.moveTo(203, 0); moving.lineTo(223, 0); moving.lineTo(223, 100); moving.lineTo(203, 100); moving.close()
  const intrusion = maximizeSafeIntrusion(fixed, moving, { axis: 'x', direction: -1, clearance: 10, maximum: 120, step: 5 })
  expect(intrusion).toBeGreaterThan(43)
  expect(outlinesIntersect(fixed, moving, -intrusion, 0)).toBe(false)
  expect(minimumInkDistance(fixed, moving, -intrusion, 0)).toBeGreaterThanOrEqual(9.99)
})

test('fits a wide standalone jamo to both dimensions of the ga envelope', () => {
  const shape = normalizeStrokePaths([{ d: 'M 0 0 L 100 0 L 100 10 L 0 10 Z', x: 0, y: 0, width: 100, height: 10 }])
  const path = composeStandaloneJamoPath(shape, DEFAULT_COMPOSITION_SETTINGS, { width: 420, height: 760, centerX: 500, centerY: 500 })
  const box = path.getBoundingBox()
  expect(box.x2 - box.x1).toBeLessThanOrEqual(420.01)
  expect(box.y2 - box.y1).toBeLessThan(100)
})

const contourBoxes = (path: opentype.Path) => {
  const boxes: Array<{ x1: number; x2: number; y1: number; y2: number }> = []
  let points: number[][] = []
  for (const command of path.commands) {
    if ('x' in command && 'y' in command) points.push([command.x, command.y])
    if (command.type === 'Z') {
      boxes.push({
        x1: Math.min(...points.map(([x]) => x)), x2: Math.max(...points.map(([x]) => x)),
        y1: Math.min(...points.map(([, y]) => y)), y2: Math.max(...points.map(([, y]) => y)),
      })
      points = []
    }
  }
  return boxes
}

test('moves a raw stroke centerline with its placement but keeps the recorded pen width', () => {
  const loop: [number, number][] = [[0, -20], [14, -14], [20, 0], [14, 14], [0, 20], [-14, 14], [-20, 0], [-14, -14], [0, -20]]
  const stroke = (id: string, x: number, y: number, points: [number, number][]) => ({
    id, type: 'freedraw' as const, x, y, width: 40, height: 40, points,
    pressures: points.map(() => 1), strokeWidth: 1, version: 1,
    simulatePressure: false as const, lastCommittedPoint: points.at(-1),
  })
  const shape = normalizeRawStrokes([
    stroke('bar', 35, 30, [[0, 0], [78, 0]]),
    stroke('loop', 74, 72, loop),
  ], 148, 1)
  const large = new opentype.Path()
  const small = new opentype.Path()
  appendShape(large, shape, { x: 100, y: 100, width: 800, height: 800 })
  appendShape(small, shape, { x: 300, y: 300, width: 400, height: 400 })
  expect(large.commands.filter((command) => command.type === 'Z')).toHaveLength(3)
  expect(small.commands.filter((command) => command.type === 'Z')).toHaveLength(3)
  const [largeBar] = contourBoxes(large)
  const [smallBar] = contourBoxes(small)
  const largePen = largeBar.y2 - largeBar.y1
  const smallPen = smallBar.y2 - smallBar.y1
  // The same pen, placed at half the size, keeps its width.
  expect(smallPen).toBeCloseTo(largePen, 0)
  // Its centerline (length minus the round caps) follows the placement.
  expect((smallBar.x2 - smallBar.x1 - smallPen) / (largeBar.x2 - largeBar.x1 - largePen)).toBeCloseTo(0.5, 1)
})

test('builds raw two-point outlines in cell space before normalization', () => {
  const points: [number, number][] = [[0, 0], [60, 0]]
  const shape = normalizeRawStrokes([{
    id: 'line', type: 'freedraw', x: 35, y: 75, width: 60, height: 0,
    points, pressures: [1, 1], strokeWidth: 1, version: 1,
    simulatePressure: false, lastCommittedPoint: points.at(-1),
  }], 148, 1)
  const contour = shape.strokes![0].contours[0]
  const width = Math.max(...contour.map(([x]) => x)) - Math.min(...contour.map(([x]) => x))
  const height = Math.max(...contour.map(([, y]) => y)) - Math.min(...contour.map(([, y]) => y))
  expect(height).toBeLessThan(0.07)
  expect(width / height).toBeGreaterThan(6)
})

test('smooths low-pressure release samples without changing captured pressure data', () => {
  const points: [number, number][] = [[0, 0], [10, 0], [20, 0], [30, 0], [45, 0], [48, 0], [50, 0]]
  const pressures = [1, 1, 1, 1, 0.03, 0.02, 0]
  const snapshot = [...pressures]
  const conditioned = conditionStroke(points, pressures, 5, 'complete', 1)
  expect(pressures).toEqual(snapshot)
  expect(conditioned.pressures.at(-1)).toBeGreaterThan(0.09)
  expect(conditioned.pressures.at(-2)).toBeGreaterThan(pressures.at(-2)!)
})

test('merges crossing CFF contours but preserves nonoverlapping curves and counters', () => {
  const crossing = new opentype.Path()
  crossing.moveTo(100, 400); crossing.lineTo(600, 400); crossing.lineTo(600, 500); crossing.lineTo(100, 500); crossing.close()
  crossing.moveTo(300, 200); crossing.lineTo(400, 200); crossing.lineTo(400, 700); crossing.lineTo(300, 700); crossing.close()
  const merged = prepareCffPath(crossing)
  expect(merged.commands.filter((command) => command.type === 'M')).toHaveLength(1)
  const separate = new opentype.Path()
  separate.moveTo(0, 0); separate.quadTo(50, 100, 100, 0); separate.close()
  separate.moveTo(200, 0); separate.quadTo(250, 100, 300, 0); separate.close()
  expect(prepareCffPath(separate).commands.filter((command) => command.type === 'Q')).toHaveLength(2)
  const loop: [number, number][] = [[0, -20], [14, -14], [20, 0], [14, 14], [0, 20], [-14, 14], [-20, 0], [-14, -14], [0, -20]]
  const ring = new opentype.Path()
  for (const contour of strokeContours(loop, loop.map(() => 1), 10)) {
    ring.moveTo(contour[0][0], contour[0][1])
    for (const [x, y] of contour.slice(1)) ring.lineTo(x, y)
    ring.close()
  }
  expect(prepareCffPath(ring).commands.filter((command) => command.type === 'M')).toHaveLength(2)
})

test('36px CFF raster keeps an overlapping stroke solid at both pixel ratios', async ({ page }, testInfo) => {
  const raw = new opentype.Path()
  raw.moveTo(100, 400); raw.lineTo(600, 400); raw.lineTo(600, 500); raw.lineTo(100, 500); raw.close()
  raw.moveTo(300, 200); raw.lineTo(400, 200); raw.lineTo(400, 700); raw.lineTo(300, 700); raw.close()
  const glyphs = [new opentype.Glyph({ name: '.notdef', index: 0, advanceWidth: 1000, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 1000, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 1000, path: raw }),
    new opentype.Glyph({ name: 'B', unicode: 66, advanceWidth: 1000, path: prepareCffPath(raw) })]
  const font = new opentype.Font({ familyName: 'CffOverlapTest', styleName: 'Regular', unitsPerEm: 1000, ascender: 900, descender: -100, glyphs })
  const buffer = font.toArrayBuffer()
  await page.goto('/')
  const pixels = await page.evaluate(async (bytes) => {
    const face = new FontFace('CffOverlapTest', new Uint8Array(bytes).buffer)
    await face.load()
    document.fonts.add(face)
    return [36, 72, 144].map((size) => [1, 2].map((ratio) => {
      const canvas = document.createElement('canvas')
      canvas.width = 160 * ratio; canvas.height = 160 * ratio
      const context = canvas.getContext('2d')!
      context.scale(ratio, ratio)
      context.font = `${size}px CffOverlapTest`
      context.fillText('A', 10, 100)
      context.fillText('B', 80, 100)
      const y = Math.round((100 - size * 0.45) * ratio)
      const rawX = Math.round((10 + size * 0.35) * ratio)
      const mergedX = Math.round((80 + size * 0.35) * ratio)
      return { raw: context.getImageData(rawX, y, 1, 1).data[3], merged: context.getImageData(mergedX, y, 1, 1).data[3] }
    }))
  }, Array.from(new Uint8Array(buffer)))
  if (testInfo.project.name === 'chromium') {
    expect(pixels[0][0].raw).toBeLessThan(50)
    expect(pixels[0][1].raw).toBeGreaterThan(200)
  }
  for (const sizes of pixels) for (const pixel of sizes) expect(pixel.merged).toBeGreaterThan(200)
})

test('right-facing vertical vowels overlap modestly, while ㅐ keeps its spacing', async () => {
  const server = await createModuleServer()
  try {
    const { composeHangulPath } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { normalizeStrokePaths } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const { DEFAULT_COMPOSITION_SETTINGS } = await server.ssrLoadModule('/src/types/project.ts')
    const { inkIntersectionArea } = await server.ssrLoadModule('/src/font/ink-collision.ts')
    const shapes = new Map()
    const initial = normalizeStrokePaths([{ d: 'M 0 0 L 6 0 L 6 60 L 0 60 Z M 0 54 L 45 54 L 45 60 L 0 60 Z M 0 0 L 45 0 L 45 6 L 0 6 Z', x: 0, y: 0, width: 45, height: 60 }])
    const medial = normalizeStrokePaths([{ d: 'M 35 0 L 41 0 L 41 60 L 35 60 Z M 0 27 L 41 27 L 41 33 L 0 33 Z', x: 0, y: 0, width: 41, height: 60 }])
    for (const char of ['ㄱ', 'ㅈ', 'ㄷ', 'ㅅ', 'ㄴ', 'ㅊ', 'ㅍ']) shapes.set(char, initial)
    for (const char of ['ㅕ', 'ㅔ', 'ㅓ', 'ㅖ', 'ㅐ']) shapes.set(char, medial)
    const parts = (char: string, gaps?: object) => {
      const path = composeHangulPath(char.codePointAt(0)!, shapes, DEFAULT_COMPOSITION_SETTINGS, gaps ? { gaps: { vertical: 43, horizontalUp: 43, horizontalDown: 43, mixed: 43, final: 43, syllables: gaps } } : undefined)
      let closes = 0
      const end = path.commands.findIndex((command) => command.type === 'Z' && ++closes === 3)
      const first = new opentype.Path()
      first.commands.push(...path.commands.slice(0, end + 1))
      const second = new opentype.Path()
      second.commands.push(...path.commands.slice(end + 1))
      return { gap: second.getBoundingBox().x1 - first.getBoundingBox().x2, intersection: inkIntersectionArea(first, second) }
    }
    const { CHOSEONG, JUNGSEONG } = await server.ssrLoadModule('/src/font/hangul.ts')
    const syllable = (initial: string, medial: string) => String.fromCodePoint(0xac00 + CHOSEONG.findIndex((part: string[]) => part[0] === initial) * 588 + JUNGSEONG.findIndex((part: string[]) => part[0] === medial) * 28)
    for (const initial of ['ㅈ', 'ㄷ', 'ㅅ', 'ㄴ', 'ㅊ', 'ㅍ']) {
      const excluded = parts(syllable(initial, 'ㅐ'))
      expect(excluded.gap).toBeGreaterThan(0)
      for (const medial of ['ㅕ', 'ㅔ', 'ㅓ', 'ㅖ']) {
        const candidate = parts(syllable(initial, medial))
        expect(candidate.gap, `${initial}+${medial}`).toBeLessThan(0)
        expect(candidate.intersection, `${initial}+${medial}`).toBe(0)
      }
    }
    expect(parts(syllable('ㄱ', 'ㅔ')).gap).toBeGreaterThan(0)
    expect(parts('네', { '네': 75 }).gap).toBeGreaterThan(0)
  } finally {
    await server.close()
  }
})

test('allows a stem to enter an open final but keeps top-bar finals separated and centered', async () => {
  const server = await createModuleServer()
  try {
    const { composeHangulPath, variantShapeKey } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { normalizeStrokePaths } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const { DEFAULT_COMPOSITION_SETTINGS } = await server.ssrLoadModule('/src/types/project.ts')
    const { DEFAULT_GAPS } = await server.ssrLoadModule('/src/font/gap-profile.ts')
    const { inkIntersectionArea } = await server.ssrLoadModule('/src/font/ink-collision.ts')
    const shape = (d: string) => normalizeStrokePaths([{ d, x: 0, y: 0, width: 100, height: 70 }])
    const shapes = new Map()
    for (const char of ['ㄱ', 'ㄴ']) shapes.set(variantShapeKey('initial', 6, char), shape('M 0 0 L 70 0 L 70 45 L 0 45 Z'))
    shapes.set(variantShapeKey('medial', 1, 'ㅜ'), shape('M 0 0 L 100 0 L 100 10 L 0 10 Z M 45 0 L 55 0 L 55 70 L 45 70 Z'))
    shapes.set(variantShapeKey('final', 0, 'ㄴ'), shape('M 0 0 L 10 0 L 10 50 L 100 50 L 100 60 L 0 60 Z'))
    shapes.set(variantShapeKey('final', 0, 'ㄱ'), shape('M 0 0 L 100 0 L 100 10 L 10 10 L 10 60 L 0 60 Z'))
    shapes.set(variantShapeKey('final', 0, 'ㅂ'), shape('M 0 0 L 10 0 L 10 60 L 0 60 Z M 90 0 L 100 0 L 100 60 L 90 60 Z M 0 50 L 100 50 L 100 60 L 0 60 Z'))

    const parts = (char: string, gaps = DEFAULT_GAPS) => {
      const path = composeHangulPath(char.codePointAt(0)!, shapes, DEFAULT_COMPOSITION_SETTINGS, { gaps })
      const roles = [new opentype.Path(), new opentype.Path(), new opentype.Path()]
      let role = 0; let closed = 0
      for (const command of path.commands) {
        roles[role].commands.push(command)
        if (command.type === 'Z') {
          closed += 1
          if (closed === 1) role = 1
          if (closed === 3) role = 2
        }
      }
      const upper = new opentype.Path()
      upper.commands.push(...roles[0].commands, ...roles[1].commands)
      const upperBox = upper.getBoundingBox()
      const finalBox = roles[2].getBoundingBox()
      return {
        gap: upperBox.y1 - finalBox.y2,
        intersection: inkIntersectionArea(upper, roles[2]),
        centerOffset: Math.abs((upperBox.x1 + upperBox.x2 - finalBox.x1 - finalBox.x2) / 2),
        finalWidth: finalBox.x2 - finalBox.x1,
      }
    }
    expect(parts('눈').gap).toBeLessThan(0)
    for (const char of ['국']) {
      expect(parts(char).gap, char).toBeGreaterThanOrEqual(0)
      expect(parts(char).centerOffset, char).toBeLessThan(1)
      expect(parts(char).finalWidth, char).toBeGreaterThan(200)
    }
    expect(parts('굽').gap).toBeLessThan(0)
    expect(parts('굽').intersection).toBe(0)
    expect(parts('굽').centerOffset).toBeLessThan(1)
    expect(parts('눈').intersection).toBeLessThan(1500)
    const negativeContext = { ...DEFAULT_GAPS, finalContexts: { horizontalDown: -80, 'horizontalDown:single': -80 } }
    expect(parts('눈', negativeContext).gap).toBeLessThan(0)
    expect(parts('국', negativeContext).gap).toBeGreaterThanOrEqual(0)
  } finally {
    await server.close()
  }
})

test('chooses the closest same-role jamo before a cross-role base', () => {
  const sources = new Map([
    [sourceKey('initial', 1, 'ㄴ'), { sourceRole: 'initial' as const }],
    [sourceKey('initial', 6, 'ㄴ'), { sourceRole: 'initial' as const }],
    ['ㄴ', { sourceRole: 'final' as const }],
  ])
  expect(selectJamoSource(sources, 'initial', 2, 'ㄴ')?.key).toBe(sourceKey('initial', 1, 'ㄴ'))
  expect(selectJamoSource(sources, 'initial', 1, 'ㄴ')?.match).toBe('exact')
  expect(selectJamoSource(new Map([['ㄴ', { sourceRole: 'final' as const }]]), 'initial', 0, 'ㄴ')?.match).toBe('cross-role')
})

test('maps pen pressure smoothly and keeps a constant width above 0.1', () => {
  expect([0, 0.05, 0.1, 0.5, 1].map(pressureResponse)).toEqual([0, 0.5, 1, 1, 1])
  const h = 0.00001
  expect((pressureResponse(0.1) - pressureResponse(0.1 - h)) / h).toBeLessThan(0.01)
  expect((pressureResponse(0.1 + h) - pressureResponse(0.1)) / h).toBe(0)
  const centerline: [number, number][] = [[0, 0], [100, 0]]
  const a = strokePolygon(centerline, [0.5, 0.5], 10)
  const b = strokePolygon(centerline, [1, 1], 10)
  expect(Math.max(...a.map((point) => point[1])) - Math.min(...a.map((point) => point[1]))).toBeCloseTo(
    Math.max(...b.map((point) => point[1])) - Math.min(...b.map((point) => point[1])), 3,
  )
})

function winding(contours: [number, number][][], x: number, y: number) {
  let result = 0
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index += 1) {
      const [ax, ay] = contour[index]
      const [bx, by] = contour[(index + 1) % contour.length]
      if (ay <= y && by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) result += 1
      if (ay > y && by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) result -= 1
    }
  }
  return result
}

test('fills the closed-stroke seam while preserving the ㅇ counter', () => {
  const circle: [number, number][] = [[0, -20], [14, -14], [20, 0], [14, 14], [0, 20], [-14, 14], [-20, 0], [-14, -14], [0, -20]]
  const contours = strokeContours(circle, circle.map(() => 1), 10)
  expect(contours.length).toBeGreaterThan(0)
  expect(winding(contours, 0, -20)).not.toBe(0)
  expect(winding(contours, 0, 0)).toBe(0)
})

test('keeps round, nonzero caps when contact pressure starts or ends at zero', () => {
  const polygon = strokePolygon([[0, 0], [20, 0], [40, 0]], [0, 1, 0], 10)
  const start = polygon.filter(([x]) => x <= 0.5)
  const end = polygon.filter(([x]) => x >= 39.5)
  expect(Math.max(...start.map(([, y]) => y)) - Math.min(...start.map(([, y]) => y))).toBeGreaterThan(8)
  expect(Math.max(...end.map(([, y]) => y)) - Math.min(...end.map(([, y]) => y))).toBeGreaterThan(8)
})

test('overlapping strokes retain ink even when written in opposite directions', () => {
  const forward = strokePolygon([[0, 0], [30, 0]], [1, 1], 10)
  const reverse = strokePolygon([[30, 0], [0, 0]], [1, 1], 10)
  expect(Math.abs(winding([forward, reverse], 15, 0))).toBe(2)
})

test('browser renders the ㅇ seam black and its center clear', async ({ page }) => {
  await page.goto('/')
  const points: [number, number][] = [[50, 30], [64, 36], [70, 50], [64, 64], [50, 70], [36, 64], [30, 50], [36, 36], [50, 30]]
  const stroke: RawStroke = { id: 'loop', type: 'freedraw', x: 0, y: 0, width: 40, height: 40, points, pressures: points.map(() => 1), strokeWidth: 10 / 4.25, version: 1, simulatePressure: false }
  const pixels = await page.evaluate(async (path) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="${path}" fill="black" fill-rule="nonzero"/></svg>`
    const image = new Image()
    image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 100
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return { seam: context.getImageData(50, 30, 1, 1).data[3], center: context.getImageData(50, 50, 1, 1).data[3] }
  }, strokeSvgPath(stroke, 148))
  expect(pixels.seam).toBeGreaterThan(200)
  expect(pixels.center).toBe(0)
})

const penStroke = (id: string, x: number, y: number, points: [number, number][], strokeWidth = 1): RawStroke => ({
  id, type: 'freedraw', x, y, width: 0, height: 0, points,
  pressures: points.map(() => 1), strokeWidth, version: 1,
  simulatePressure: false, lastCommittedPoint: points.at(-1),
})

const centerlineSize = (path: opentype.Path, pen: number) => {
  const box = path.getBoundingBox()
  return Math.sqrt((box.x2 - box.x1 - pen) * (box.y2 - box.y1 - pen))
}

test('keeps the same pen width in every jamo of a composed syllable and in numerals', async () => {
  const server = await createModuleServer()
  try {
    const { composeHangulParts } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { appendNumeral } = await server.ssrLoadModule('/src/font/symbol-placement.ts')
    const { normalizeRawStrokes: normalize } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    // Base jamo written at very different sizes: rescaling their outlines
    // would make the small ㄴ thick and the long ㅡ thin.
    const shapes = new Map([
      ['ㄴ', normalize([penStroke('n', 60, 60, [[0, 0], [0, 20], [25, 20]])], 148, 0)],
      ['ㅡ', normalize([penStroke('eu', 10, 74, [[0, 0], [128, 0]])], 148, 0)],
    ])
    const { parts } = composeHangulParts('느'.codePointAt(0)!, shapes, DEFAULT_COMPOSITION_SETTINGS)
    const medial = contourBoxes(parts.medial)[0]
    const initial = contourBoxes(parts.initial)[0]
    const medialPen = medial.y2 - medial.y1
    // Above the corner only ㄴ's vertical leg has ink: its width is the pen.
    const legXs = (parts.initial as opentype.Path).commands.flatMap((command) => 'x' in command && command.y > (initial.y1 + initial.y2) / 2 ? [command.x] : [])
    const initialPen = Math.max(...legXs) - Math.min(...legXs)
    expect(initialPen / medialPen).toBeGreaterThan(0.9)
    expect(initialPen / medialPen).toBeLessThan(1.1)

    const one = new opentype.Path()
    const wide = new opentype.Path()
    appendNumeral(one, normalize([penStroke('one', 74, 20, [[0, 0], [0, 110]])], 148, 0))
    appendNumeral(wide, normalize([penStroke('wide', 74, 20, [[0, 0], [0, 110]], 2)], 148, 0))
    const onePen = contourBoxes(one)[0].x2 - contourBoxes(one)[0].x1
    // A stroke written with a pen twice as wide stays twice as wide.
    expect((contourBoxes(wide)[0].x2 - contourBoxes(wide)[0].x1) / onePen).toBeCloseTo(2, 1)
    expect(onePen / medialPen).toBeGreaterThan(0.9)
    expect(onePen / medialPen).toBeLessThan(1.1)
  } finally {
    await server.close()
  }
})

test('follows the learned initial : final size ratio of a stacked syllable', async () => {
  const server = await createModuleServer()
  try {
    const { composeHangulParts } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { normalizeRawStrokes: normalize } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const shapes = new Map([
      // A small ㄴ and a large ㄹ, captured standalone.
      ['ㄴ', normalize([penStroke('n', 60, 60, [[0, 0], [0, 20], [25, 20]])], 148, 0)],
      ['ㅡ', normalize([penStroke('eu', 10, 74, [[0, 0], [128, 0]])], 148, 0)],
      ['ㄹ', normalize([
        penStroke('r1', 20, 20, [[0, 0], [100, 0], [100, 50]]),
        penStroke('r2', 20, 70, [[100, 0], [0, 0], [0, 50]]),
        penStroke('r3', 20, 120, [[0, 0], [100, 0]]),
      ], 148, 0)],
    ])
    const codePoint = '늘'.codePointAt(0)!
    const ratio = (parts: { initial: opentype.Path; medial: opentype.Path; final: opentype.Path }) => {
      // ㅡ is one horizontal stroke: its height is the pen.
      const eu = contourBoxes(parts.medial)[0]
      const pen = eu.y2 - eu.y1
      return centerlineSize(parts.final, pen) / centerlineSize(parts.initial, pen)
    }
    const unlearned = ratio(composeHangulParts(codePoint, shapes, DEFAULT_COMPOSITION_SETTINGS).parts)
    const target = 1.3
    const proportions = { contexts: { 'horizontalDown:final': { final: target, sampleCount: 4 } }, pairs: {}, syllables: {} }
    const learned = ratio(composeHangulParts(codePoint, shapes, DEFAULT_COMPOSITION_SETTINGS, { proportions }).parts)
    expect(Math.abs(unlearned - target)).toBeGreaterThan(0.2)
    expect(Math.abs(learned / target - 1)).toBeLessThan(0.05)
    // Without learned samples the zone layout stays as before.
    const empty = { contexts: {}, pairs: {}, syllables: {} }
    expect(ratio(composeHangulParts(codePoint, shapes, DEFAULT_COMPOSITION_SETTINGS, { proportions: empty }).parts)).toBeCloseTo(unlearned, 6)
  } finally {
    await server.close()
  }
})

test('learns jamo proportions from completed sentence syllables', async () => {
  const server = await createModuleServer()
  try {
    const { learnProportions } = await server.ssrLoadModule('/src/font/proportion-learning.ts')
    const { WRITING_EXERCISES } = await server.ssrLoadModule('/src/lib/writing-exercises.ts')
    const exercise = WRITING_EXERCISES.find((item: { id: string }) => item.id === 'hangul-base-1')
    const cellIndex = exercise.cells.findIndex((cell: { char: string }) => cell.char === '들')
    const columns = exercise.cells.length
    const x = cellIndex * 148
    // ㄷ and ㄹ with the same 40×20 centerline box, ㅡ 100 long.
    const slots = [
      [penStroke('d1', x + 50, 20, [[0, 0], [40, 0]]), penStroke('d2', x + 50, 20, [[0, 0], [0, 20], [40, 20]])],
      [penStroke('eu', x + 20, 60, [[0, 0], [100, 0]])],
      [penStroke('r1', x + 50, 90, [[0, 0], [40, 0], [40, 10]]), penStroke('r2', x + 50, 100, [[40, 0], [0, 0], [0, 10]]), penStroke('r3', x + 50, 110, [[0, 0], [40, 0]])],
    ]
    const session = {
      exerciseId: exercise.id, text: exercise.text, cellSize: 148, columns, updatedAt: 0, boundaries: {},
      elements: slots.flat(),
      assignments: slots.flatMap((strokes, slotIndex) => strokes.map((stroke) => ({ elementId: stroke.id, cellIndex, slotIndex, promptId: exercise.cells[cellIndex].slots[slotIndex].promptId }))),
    }
    const profile = learnProportions({ [exercise.id]: session })
    expect(profile.syllables['들'].final).toBeCloseTo(1, 5)
    expect(profile.contexts['horizontalDown:final'].final).toBeCloseTo(1, 5)
    expect(profile.contexts['horizontalDown:final'].medial).toBeCloseTo(100 / Math.sqrt(800), 5)
  } finally {
    await server.close()
  }
})

test('a locked syllable is the canvas guide plus the jamo written in the cell', async () => {
  const server = await createModuleServer()
  try {
    const { composeGuideParts, composeLockedHangulPath } = await server.ssrLoadModule('/src/font/syllable-lock.ts')
    const { normalizeRawStrokes: normalize, appendShape: place } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const withCell = (shape: ReturnType<typeof normalizeRawStrokes>, sourceCellId: string) => Object.assign(shape, { sourceCellId })
    const shapes = new Map([
      ['initial:5:ㄱ', withCell(normalize([penStroke('g', 20, 30, [[0, 0], [40, 0], [40, 50]])], 148, 0), 'a:0')],
      ['medial:1:ㅏ', withCell(normalize([penStroke('a1', 100, 20, [[0, 0], [0, 80]]), penStroke('a2', 100, 55, [[0, 0], [20, 0]])], 148, 0), 'b:0')],
      ['ㄱ', normalize([penStroke('base', 40, 40, [[0, 0], [60, 0], [60, 60]])], 148, 0)],
    ])
    const codePoint = '각'.codePointAt(0)!
    const guide = composeGuideParts(codePoint, shapes, DEFAULT_COMPOSITION_SETTINGS, {}, 'lock:0')
    const written = withCell(normalize([penStroke('final', 40, 110, [[0, 0], [60, 0], [60, 25]])], 148, 0), 'lock:0')
    const after = new Map([...shapes, ['final:0:ㄱ', written]])
    // Writing the missing final must not move the fixed guide jamo.
    const guideAfter = composeGuideParts(codePoint, after, DEFAULT_COMPOSITION_SETTINGS, {}, 'lock:0')
    expect(guideAfter.parts.initial.commands).toEqual(guide.parts.initial.commands)
    expect(guideAfter.parts.medial.commands).toEqual(guide.parts.medial.commands)

    const locked: opentype.Path = composeLockedHangulPath(codePoint, after, DEFAULT_COMPOSITION_SETTINGS, {}, { cellId: 'lock:0', writtenRoles: ['final'] })
    const fixedCount = guide.parts.initial.commands.length + guide.parts.medial.commands.length
    expect(locked.commands.slice(0, fixedCount)).toEqual([...guide.parts.initial.commands, ...guide.parts.medial.commands])
    const asWritten = new opentype.Path()
    place(asWritten, written, { x: 0, y: 0, width: 1000, height: 1000 }, true)
    expect(locked.commands.slice(fixedCount)).toEqual(asWritten.commands)
  } finally {
    await server.close()
  }
})

test('numerals get the height and baseline of ! and ?', async () => {
  test.setTimeout(120_000)
  const server = await createModuleServer()
  try {
    const { composeFont } = await server.ssrLoadModule('/src/font/composer.ts')
    const { DEFAULT_GAPS } = await server.ssrLoadModule('/src/font/gap-profile.ts')
    const drawing = (strokes: RawStroke[]) => ({ elements: strokes, cellSize: 148 })
    const request = {
      type: 'compose-font',
      drawings: {
        [`symbol-${'!'.codePointAt(0)}`]: drawing([penStroke('bang', 74, 20, [[0, 0], [0, 80]]), penStroke('dot', 74, 120, [[0, 0], [0.5, 0]])]),
        [`number-${'1'.codePointAt(0)}`]: drawing([penStroke('one', 74, 10, [[0, 0], [0, 128]])]),
        [`number-${'4'.codePointAt(0)}`]: drawing([penStroke('four', 40, 30, [[40, 0], [0, 60], [60, 60]]), penStroke('four2', 80, 50, [[0, 0], [0, 70]])]),
      },
      metadata: { familyName: 'T', styleName: 'Regular', designer: '', version: '1.0' },
      overrides: {}, globalMetrics: { left: 0, right: 0, y: 0 },
      compositionSettings: DEFAULT_COMPOSITION_SETTINGS,
      gaps: DEFAULT_GAPS, proportions: { contexts: {}, pairs: {}, syllables: {} }, lockedSyllables: {},
      hangulTargetHeight: 760, hangulTargetCenter: 500, unitsPerEm: 1000,
    }
    const { buffer } = await composeFont(request, { cancelled: () => false, progress: () => {} })
    const font = opentype.parse(buffer)
    const box = (char: string) => font.charToGlyph(char).getBoundingBox()
    for (const digit of ['1', '4']) {
      expect(Math.abs((box(digit).y2 - box(digit).y1) / (box('!').y2 - box('!').y1) - 1)).toBeLessThan(0.02)
      expect(box(digit).y1).toBeCloseTo(box('!').y1, 0)
    }
  } finally {
    await server.close()
  }
})
