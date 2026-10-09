// 합성 속도·품질 측정 하네스.
//   node tools/project/profile.mjs [sampleStep] [chars]
// src/dev/sample-project.json(tools/project/export-project.js로 내보낸 프로젝트)을 읽어
// 음절 합성 시간과 학습 프로필 규모를 출력하고 tools/out/sheet.svg 컨택트 시트를 만든다.
import { hasNonFinite } from '../lib/glyphs.mjs'
import { writeOut } from '../lib/out.mjs'
import { loadProject } from '../lib/project.mjs'
import { startVite } from '../lib/vite.mjs'

const project = loadProject()
const step = Number(process.argv[2] ?? 1)
const chars = [...(process.argv[3] ?? '계괌다가각곡고구뭐웨읽닭깲꽈낡나넣뇲뢒뢥')]

const server = await startVite()
try {
  const inputs = await server.ssrLoadModule('/src/generation/inputs.ts')
  const composer = await server.ssrLoadModule('/src/generation/font-builder.ts')
  const samples = await server.ssrLoadModule('/src/generation/learning/samples.ts')
  const { svgPathData } = await server.ssrLoadModule('/src/font/geometry/svg.ts')

  const settings = project.compositionSettings
  const sessions = project.writingSessions ?? {}
  const tInputs = performance.now()
  const generation = inputs.buildGenerationInputs(project.drawings, sessions, settings)
  const request = {
    type: 'compose-font', ...generation, metadata: project.metadata, overrides: project.glyphOverrides ?? {},
    globalMetrics: project.globalMetrics, compositionSettings: settings, unitsPerEm: 1000,
  }
  const msInputs = performance.now() - tInputs

  const tContext = performance.now()
  const prepared = composer.prepareCompositionContext(request)
  const msContext = performance.now() - tContext

  const completed = samples.completedHangulCells(sessions).length
  console.log(JSON.stringify({
    drawings: Object.keys(project.drawings).length,
    sessions: Object.keys(sessions).length,
    shapes: prepared.shapes.size,
    completedHangulCells: completed,
    learnedGapSyllables: Object.keys(generation.gaps.initialMedialSyllables).length,
    learnedProportionSyllables: Object.keys(generation.proportions.syllables ?? {}).length,
    hangulTargetHeight: generation.hangulTargetHeight,
    hangulTargetSize: generation.hangulTargetSize,
    hangulTargetCenter: generation.hangulTargetCenter,
    visualScale: prepared.visualScale,
    msInputs: Math.round(msInputs), msContext: Math.round(msContext),
  }, null, 2))

  const tCompose = performance.now()
  let count = 0
  const nonFinite = []
  for (let index = 0; index < 11172; index += step) {
    const path = composer.composedHangulPath(0xac00 + index, prepared.shapes, request, prepared.visualScale)
    if (hasNonFinite(path.commands)) nonFinite.push(String.fromCodePoint(0xac00 + index))
    count += 1
  }
  const ms = performance.now() - tCompose
  console.log(`composed ${count} syllables in ${Math.round(ms)} ms (${(ms / count).toFixed(2)} ms/glyph, full set ≈ ${Math.round(ms / count * 11172 / 1000)} s single thread)`)

  console.log(`glyphs with non-finite coordinates: ${nonFinite.length}`, nonFinite.slice(0, 40).join(''))

  const cell = 120
  const columns = Math.min(Number(process.argv[4] ?? 6), chars.length)
  const rows = Math.ceil(chars.length / columns) * 1.2
  const body = chars.map((char, index) => {
    const path = composer.composedHangulPath(char.codePointAt(0), prepared.shapes, request, prepared.visualScale)
    const badIndex = path.commands.findIndex((c) => c.type !== 'Z' && ['x', 'y'].some((k) => !Number.isFinite(c[k])))
    if (badIndex >= 0) console.log('NaN in', char, 'at command', badIndex, 'of', path.commands.length, JSON.stringify(path.commands.slice(badIndex - 1, badIndex + 2)))
    const x = (index % columns) * cell
    const y = Math.floor(index / columns) * cell * 1.2 + cell * 0.1
    return `<g transform="translate(${x} ${y + cell}) scale(${cell / 1000} ${-cell / 1000})"><rect x="0" y="0" width="1000" height="1000" fill="none" stroke="#ccc" stroke-width="6"/><path d="${svgPathData(path.commands)}" fill="#111"/></g>`
  }).join('\n')
  writeOut('sheet.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${columns * cell} ${rows * cell}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`)
  console.log('wrote tools/out/sheet.svg')
} finally {
  await server.close()
}
