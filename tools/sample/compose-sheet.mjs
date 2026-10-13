// node tools/sample/compose-sheet.mjs --project=<full project json> [--name=compose-sheet]
// Composes syllables from a full project file and writes tools/out/<name>.svg.
import { readFileSync } from 'node:fs'
import { hasNonFinite } from '../lib/glyphs.mjs'
import { writeOut } from '../lib/out.mjs'
import { pathData } from '../lib/svg.mjs'
import { startVite } from '../lib/vite.mjs'

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const { meta, sessions, drawings } = JSON.parse(readFileSync(arg('project'), 'utf8'))
const name = arg('name', 'compose-sheet')
const chars = [...'괌낡넘뢒뢥꽈깲뇲줬계뭐가고구그각곡굵읽닭를틀말답']
const server = await startVite()
try {
  const builder = await server.ssrLoadModule('/src/generation/font-builder.ts')
  const inputs = await server.ssrLoadModule('/src/generation/inputs.ts')
  const { completedHangulCells } = await server.ssrLoadModule('/src/generation/learning/samples.ts')
  const settings = { ...(await server.ssrLoadModule('/src/font/settings.ts')).DEFAULT_COMPOSITION_SETTINGS, ...meta.compositionSettings }
  const request = {
    type: 'compose-font', ...inputs.buildGenerationInputs(drawings, sessions, settings), compositionSettings: settings,
    metadata: { familyName: 'Sheet', styleName: 'Regular', designer: '', version: '1.0' }, overrides: {}, globalMetrics: { left: 0, right: 0, y: 0 }, unitsPerEm: 1000,
  }
  const prepared = builder.prepareCompositionContext(request)
  const columns = 8
  let bad = 0
  const body = chars.map((char, index) => {
    const commands = builder.composedHangulParts(char.codePointAt(0), prepared.shapes, request, prepared.visualScale).path.commands
    if (!commands.length || hasNonFinite(commands)) bad += 1
    const x = index % columns * 185
    const y = Math.floor(index / columns) * 200 + 24
    return `<text x="${x + 4}" y="${y - 6}" font-size="13">${char}</text><g transform="translate(${x} ${y + 150}) scale(.16 -.16)"><rect x="0" y="-150" width="1000" height="1050" fill="none" stroke="#ddd" stroke-width="4"/><path d="${pathData(commands)}" fill="#111"/></g>`
  }).join('')
  writeOut(`${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${columns * 185} ${Math.ceil(chars.length / columns) * 200 + 24}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`)
  console.log(`wrote tools/out/${name}.svg; empty or invalid glyphs: ${bad}; complete cells for learning: ${completedHangulCells(sessions).length}`)
} finally { await server.close() }
