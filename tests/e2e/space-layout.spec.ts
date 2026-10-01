import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import opentype from 'opentype.js'
import { DEFAULT_COMPOSITION_SETTINGS, type StoredGuideRole } from '../../src/types/project'

test('exports captured medial and final ink when the initial source is missing', async () => {
  test.setTimeout(120_000)
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { normalizeRawStrokes } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const { composedHangulParts, composeFont, precomposeHangulRange } = await server.ssrLoadModule('/src/font/composer.ts')
    const { DEFAULT_GAPS } = await server.ssrLoadModule('/src/font/gap-profile.ts')
    const stroke = (x: number, y: number, points: [number, number][]) => ({ id: `${x}`, type: 'freedraw', x, y, width: 0, height: 0, points, pressures: points.map(() => 1), strokeWidth: 1, version: 1, simulatePressure: false })
    const medial = Object.assign(normalizeRawStrokes([stroke(100, 20, [[0, 0], [0, 45], [20, 45]])], 148, 0), { sourceCellId: 'partial-cell' })
    const final = Object.assign(normalizeRawStrokes([stroke(30, 110, [[0, 0], [50, 0], [50, 20]])], 148, 0), { sourceCellId: 'partial-cell' })
    const shapes = new Map([['medial:1:ㅏ', medial], ['final:0:ㄱ', final]])
    const request = { compositionSettings: DEFAULT_COMPOSITION_SETTINGS, gaps: DEFAULT_GAPS, proportions: { contexts: {}, pairs: {}, syllables: {} }, hangulTargetHeight: 760, hangulTargetCenter: 500 }
    const result = composedHangulParts('낙'.codePointAt(0), shapes, request, 1)
    expect(result.parts.initial.commands).toHaveLength(0)
    expect(result.parts.medial.commands.length).toBeGreaterThan(0)
    expect(result.parts.final.commands.length).toBeGreaterThan(0)
    expect(result.geometry.groups.medial).toBe(result.geometry.groups.final)
    expect(result.path.commands.every((command: Record<string, unknown>) => Object.values(command).every(value => typeof value !== 'number' || Number.isFinite(value)))).toBe(true)
    const preparedContext = { shapes, visualScale: 1 }
    const offset = '낙'.codePointAt(0)! - 0xac00
    const records = await precomposeHangulRange(request, offset, offset + 1, undefined, structuredClone(preparedContext))
    expect(records[0].commands).toEqual(result.path.commands)
    const { buffer, glyphCount } = await composeFont({
      ...request, type: 'compose-font', drawings: {},
      metadata: { familyName: 'Partial', styleName: 'Regular', designer: '', version: '1.0' },
      overrides: {}, globalMetrics: { left: 0, right: 0, y: 0 }, unitsPerEm: 1000,
    }, { cancelled: () => false, progress: () => {}, preparedContext })
    expect(glyphCount).toBeGreaterThanOrEqual(11_172)
    const glyph = opentype.parse(buffer).charToGlyph('낙')
    expect(glyph.path.commands.length).toBeGreaterThan(0)
    expect(Object.values(glyph.getBoundingBox()).every(Number.isFinite)).toBe(true)
  } finally { await server.close() }
})

test('preserves each source aspect and connected medial topology across space layouts', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { composeHangulParts } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { normalizeStrokePaths } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const { INITIALS, MEDIALS, FINALS } = await server.ssrLoadModule('/src/font/hangul-structure.ts')
    const source = normalizeStrokePaths([{ d: 'M0 0L60 0L60 10L25 10L25 90L15 90L15 10L0 10Z', x: 0, y: 0, width: 60, height: 90 }])
    const shapes = new Map([...INITIALS, ...MEDIALS, ...FINALS.filter(Boolean)].map(char => [char, source]))
    for (const char of '가고구그괌꽈계뭐낡뢒뢥줬읽닭') {
      const result = composeHangulParts(char.codePointAt(0), shapes, DEFAULT_COMPOSITION_SETTINGS)
      for (const part of Object.values(result.parts) as opentype.Path[]) {
        if (!part.commands.length) continue
        const box = part.getBoundingBox()
        expect((box.x2 - box.x1) / (box.y2 - box.y1), char).toBeCloseTo(source.aspectRatio, 7)
        expect(part.commands.map(c => c.type), char).toEqual(source.commands.map((c: { code: string }) => c.code.toUpperCase()))
      }
    }
    expect(source.commands[0]).toEqual({ code: 'M', x: 0, y: 0 })
  } finally { await server.close() }
})

test('moves a captured group with one scale while centering an unrelated final', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { composeHangulParts } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { normalizeRawStrokes, appendShape } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const stroke = (x: number, y: number, points: [number, number][]) => ({ id: `${x}`, type: 'freedraw', x, y, width: 0, height: 0, points, pressures: points.map(() => 1), strokeWidth: 1, version: 1, simulatePressure: false })
    const initial = Object.assign(normalizeRawStrokes([stroke(25, 40, [[0, 0], [20, 0], [20, 35]])], 148, 0), { sourceCellId: 'captured' })
    const medial = Object.assign(normalizeRawStrokes([stroke(80, 15, [[0, 0], [0, 45], [20, 45]])], 148, 0), { sourceCellId: 'captured' })
    const final = Object.assign(normalizeRawStrokes([stroke(10, 100, [[0, 0], [35, 0], [35, 20]])], 148, 0), { sourceCellId: 'other' })
    const shapes = new Map([['initial:5:ㄱ', initial], ['medial:1:ㅏ', medial], ['final:0:ㄱ', final]])
    const result = composeHangulParts('각'.codePointAt(0), shapes, DEFAULT_COMPOSITION_SETTINGS)
    expect(result.geometry.scales.initial).toBeCloseTo(result.geometry.scales.medial, 9)
    const center = (path: opentype.Path) => { const b = path.getBoundingBox(); return [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2] }
    const native = [initial, medial].map(shape => { const path = new opentype.Path(); appendShape(path, shape, { x: 0, y: 0, width: 1000, height: 1000 }, true); return center(path) })
    const placed = [center(result.parts.initial), center(result.parts.medial)]
    const sx = (placed[1][0] - placed[0][0]) / (native[1][0] - native[0][0])
    const sy = (placed[1][1] - placed[0][1]) / (native[1][1] - native[0][1])
    expect(sx / sy).toBeCloseTo(1, 1)
    const boxes = [result.parts.initial.getBoundingBox(), result.parts.medial.getBoundingBox()]
    expect(center(result.parts.final)[0]).toBeCloseTo((Math.min(...boxes.map(b => b.x1)) + Math.max(...boxes.map(b => b.x2))) / 2, 5)
  } finally { await server.close() }
})

test('keeps missing-source geometry finite and calibrates preview and export identically', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { composeHangulParts } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { composedHangulParts, composedHangulPath } = await server.ssrLoadModule('/src/font/composer.ts')
    const { DEFAULT_GAPS } = await server.ssrLoadModule('/src/font/gap-profile.ts')
    const request = { compositionSettings: DEFAULT_COMPOSITION_SETTINGS, gaps: DEFAULT_GAPS, proportions: { contexts: {}, pairs: {}, syllables: {} }, hangulTargetHeight: 760, hangulTargetCenter: 500 }
    const cp = '괌'.codePointAt(0)
    const result = composeHangulParts(cp, new Map(), DEFAULT_COMPOSITION_SETTINGS, { placeholderRoles: ['initial', 'medial', 'final'] })
    expect(result.path.commands).toHaveLength(0)
    expect(Object.keys(result.placeholders)).toHaveLength(3)
    for (const b of Object.values(result.placeholders) as Array<Record<string, number>>) expect(Object.values(b).every(Number.isFinite)).toBe(true)
    expect(composedHangulParts(cp, new Map(), request, 1.2).path.commands).toEqual(composedHangulPath(cp, new Map(), request, 1.2).commands)
    const { normalizeRawStrokes } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const captured = Object.assign(normalizeRawStrokes([{ id: 'partial', type: 'freedraw', x: 20, y: 30, width: 0, height: 0, points: [[0, 0], [40, 0], [40, 35]], pressures: [1, 1, 1], strokeWidth: 1, version: 1 }], 148, 0), { sourceCellId: 'captured-partial' })
    for (const char of '각괌굵') {
      const onlyInitial = new Map([[`initial:${char === '각' ? 5 : char === '괌' ? 7 : 6}:ㄱ`, captured]])
      const partial = composeHangulParts(char.codePointAt(0), onlyInitial, DEFAULT_COMPOSITION_SETTINGS)
      expect(partial.parts.initial.commands.length).toBeGreaterThan(0)
      expect(partial.path.commands.every((command: Record<string, unknown>) => Object.values(command).every(value => typeof value !== 'number' || Number.isFinite(value)))).toBe(true)
    }
  } finally { await server.close() }
})

test('releases crossing captured groups and preserves synthesized component similarity', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { composeHangulParts } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { normalizeRawStrokes, combineShapesSideBySide } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const { inkIntersectionArea } = await server.ssrLoadModule('/src/font/ink-collision.ts')
    const source = (points: [number, number][]) => Object.assign(normalizeRawStrokes([{ id: 'stroke', type: 'freedraw', x: 40, y: 20, width: 0, height: 0, points, pressures: points.map(() => 1), strokeWidth: 1, version: 1, simulatePressure: false }], 148, 0), { sourceCellId: 'crossing' })
    const left = source([[0, 0], [20, 40]])
    const right = source([[20, 0], [0, 40]])
    const result = composeHangulParts('가'.codePointAt(0), new Map([['initial:0:ㄱ', left], ['medial:0:ㅏ', right]]), DEFAULT_COMPOSITION_SETTINGS)
    expect(result.geometry.groups.initial).not.toBe(result.geometry.groups.medial)
    expect(inkIntersectionArea(result.parts.initial, result.parts.medial)).toBe(0)
    const compound = combineShapesSideBySide(left, right)
    expect(compound.synthesized).toBe(true)
    for (const [index, original] of [left, right].entries()) {
      const before = original.strokes[0].centerline.points
      const after = compound.strokes[index].centerline.points
      const sx = (after[1][0] - after[0][0]) / (before[1][0] - before[0][0])
      const sy = (after[1][1] - after[0][1]) / (before[1][1] - before[0][1])
      expect(sx).toBeCloseTo(sy, 9)
      expect(compound.strokes[index].centerline.diameter).toBe(original.strokes[0].centerline.diameter)
    }
  } finally { await server.close() }
})

test('insets automatic 끓 and 래 guides and migrates saved guides only once', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { composeCellGuide, toGuideCommands } = await server.ssrLoadModule('/src/font/cell-guides.ts')
    const { composeGuideParts } = await server.ssrLoadModule('/src/font/syllable-lock.ts')
    const { normalizeStrokePaths } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const line = normalizeStrokePaths([{ d: 'M0 0L180 0L180 6L0 6Z', x: 0, y: 0, width: 180, height: 6 }])
    const tall = normalizeStrokePaths([{ d: 'M0 0L50 0L50 140L0 140Z', x: 0, y: 0, width: 50, height: 140 }])
    const shapes = new Map([['ㅡ', line], ['ㄹ', tall], ['ㅐ', tall]])
    for (const char of ['끓', '래']) {
      const roles = char === '끓' ? ['medial'] : ['initial', 'medial']
      const input = { codePoint: char.codePointAt(0), cellId: 'writing:0', guideRoles: Object.fromEntries(roles.map(role => [role, role])), writtenRoles: [], shapes, settings: DEFAULT_COMPOSITION_SETTINGS, options: {} }
      const raw = composeGuideParts(input.codePoint, shapes, input.settings, {}, input.cellId, roles)
      const legacy = { roles: Object.fromEntries(roles.map(role => {
        const b = raw.parts[role].getBoundingBox()
        const rounded = Object.fromEntries(['x1', 'y1', 'x2', 'y2'].map(key => [key, Math.round(b[key] * 100) / 100]))
        return [role, { source: role, box: rounded, commands: toGuideCommands(raw.parts[role]) }]
      })), placeholders: raw.placeholders }
      const fresh = composeCellGuide(input)
      const migrated = composeCellGuide({ ...input, stored: legacy })
      for (const role of roles) {
        const before = legacy.roles[role].box
        const after = fresh.roles[role].box
        expect(after.x2 - after.x1, `${char} ${role}`).toBeLessThanOrEqual((before.x2 - before.x1) * 0.8 + 0.02)
        expect(after.x2 - after.x1, `${char} ${role}`).toBeGreaterThanOrEqual((before.x2 - before.x1) * 0.8 - 0.02)
        expect(after.y2 - after.y1, `${char} ${role}`).toBeCloseTo((before.y2 - before.y1) * 0.8, 1)
        expect((after.x2 - after.x1) / (after.y2 - after.y1)).toBeCloseTo((before.x2 - before.x1) / (before.y2 - before.y1), 1)
        expect(migrated.roles[role].box).toEqual(after)
      }
      for (const b of [...Object.values(fresh.roles).map((entry) => (entry as StoredGuideRole).box), ...Object.values(fresh.placeholders)] as Array<Record<string, number>>) {
        expect(Math.min(b.x1, b.y1)).toBeGreaterThanOrEqual(100)
        expect(Math.max(b.x2, b.y2)).toBeLessThanOrEqual(900)
      }
      expect(composeCellGuide({ ...input, stored: migrated })).toEqual(migrated)
      expect(composeCellGuide({ ...input, stored: fresh })).toEqual(fresh)
      const damaged = { ...fresh, sizingVersion: 1, roles: Object.fromEntries(Object.entries(fresh.roles).map(([role, value]) => [role, { ...(value as StoredGuideRole), box: { x1: 490, y1: 490, x2: 510, y2: 510 }, commands: [] }])) }
      expect(composeCellGuide({ ...input, stored: damaged })).toEqual(fresh)
      expect(legacy).not.toHaveProperty('sizingVersion')
    }
  } finally { await server.close() }
})

test('does not shrink a horizontal guide using learned ratios against an unwritten initial', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { composeCellGuide } = await server.ssrLoadModule('/src/font/cell-guides.ts')
    const { normalizeStrokePaths } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const medial = normalizeStrokePaths([{ d: 'M0 0L180 0L180 6L0 6Z', x: 0, y: 0, width: 180, height: 6 }])
    const skinny = normalizeStrokePaths([{ d: 'M0 0L2 0L2 100L0 100Z', x: 0, y: 0, width: 2, height: 100 }])
    const wide = normalizeStrokePaths([{ d: 'M0 0L100 0L100 2L0 2Z', x: 0, y: 0, width: 100, height: 2 }])
    const input = { codePoint: '끓'.codePointAt(0), cellId: 'writing:0', guideRoles: { medial: 'medial' }, writtenRoles: [], shapes: new Map([['ㅡ', medial]]), settings: DEFAULT_COMPOSITION_SETTINGS, options: {} }
    const expected = composeCellGuide(input)
    for (const donor of [skinny, wide]) {
      const guide = composeCellGuide({ ...input, shapes: new Map([['ㅡ', medial], ['ㄲ', donor], ['ㅀ', donor]]), options: { proportions: { contexts: { 'horizontalDown:final': { medial: 0.3, final: 0.4, sampleCount: 1 }, 'horizontalUp:final': { medial: 0.3, final: 0.4, sampleCount: 1 } }, pairs: {}, syllables: {} } } })
      expect(guide).toEqual(expected)
      expect(guide.roles.medial.box.x2 - guide.roles.medial.box.x1).toBeGreaterThan(500)
    }
  } finally { await server.close() }
})

test('freezes displayed cell guides after other sources and the missing role change', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { composeCellGuide } = await server.ssrLoadModule('/src/font/cell-guides.ts')
    const { normalizeStrokePaths } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const shape = normalizeStrokePaths([{ d: 'M0 0L30 0L30 50L0 50Z', x: 0, y: 0, width: 30, height: 50 }])
    const input = { codePoint: '각'.codePointAt(0), cellId: 'writing:0', guideRoles: { initial: 'source-a', medial: 'source-b' }, writtenRoles: [], shapes: new Map([['ㄱ', shape], ['ㅏ', shape]]), settings: DEFAULT_COMPOSITION_SETTINGS, options: {} }
    const displayed = composeCellGuide(input)
    expect(Object.keys(displayed.roles)).toEqual(['initial', 'medial'])
    const changed = normalizeStrokePaths([{ d: 'M0 0L90 0L90 20L0 20Z', x: 0, y: 0, width: 90, height: 20 }])
    const captured = { ...changed, sourceCellId: 'writing:0' }
    const next = composeCellGuide({ ...input, stored: displayed, writtenRoles: ['final'], shapes: new Map([['ㄱ', changed], ['ㅏ', changed], ['final:0:ㄱ', captured]]) })
    expect(next).toEqual(displayed)
  } finally { await server.close() }
})

test('keeps a compound medial crossbar out of the left compartment and centers its final under the whole medial', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error' })
  try {
    const { composeHangulParts } = await server.ssrLoadModule('/src/font/hangul.ts')
    const { medialSpace } = await server.ssrLoadModule('/src/font/syllable-layout.ts')
    const { normalizeStrokePaths } = await server.ssrLoadModule('/src/font/path-geometry.ts')
    const shape = (d: string, width: number, height: number) => normalizeStrokePaths([{ d, x: 0, y: 0, width, height }])
    const medial = shape('M0 55L60 55L60 60L0 60Z M25 40L30 40L30 60L25 60Z M65 0L70 0L70 70L65 70Z M65 30L85 30L85 35L65 35Z M85 0L90 0L90 70L85 70Z', 90, 70)
    const consonant = shape('M0 0L40 0L40 30L0 30Z', 40, 30)
    const result = composeHangulParts('뢥'.codePointAt(0), new Map([['ㄹ', consonant], ['ㅙ', medial], ['ㅂ', consonant]]), DEFAULT_COMPOSITION_SETTINGS)
    const space = medialSpace(result.parts.medial)
    expect(space.horizontal.x2).toBeLessThan(space.vertical.x1)
    const i = result.parts.initial.getBoundingBox(); const m = result.parts.medial.getBoundingBox(); const f = result.parts.final.getBoundingBox()
    expect((i.x1 + i.x2) / 2).toBeLessThan((m.x1 + m.x2) / 2)
    expect(i.y2 - m.y2).toBeLessThan((m.y2 - m.y1) * 0.45)
    expect((f.x1 + f.x2) / 2).toBeCloseTo((m.x1 + m.x2) / 2, 5)
  } finally { await server.close() }
})
