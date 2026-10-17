// node tools/verify/golden.mjs [--out=golden.json]
// Composes a fixed sample from the example handwriting (src/features/samples/example.json) and writes every
// outline, so a refactor can be checked for byte-identical font output.
import { createHash } from 'node:crypto'
import opentype from 'opentype.js'
import { MATRIX, REQUIRED } from '../lib/glyphs.mjs'
import { writeOut } from '../lib/out.mjs'
import { loadProject } from '../lib/project.mjs'
import { startVite } from '../lib/vite.mjs'

const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'golden.json'
const project = await loadProject()
const stride = Array.from({ length: 153 }, (_, i) => 0xac00 + i * 73)
const server = await startVite()
try {
  const builder = await server.ssrLoadModule('/src/generation/font-builder.ts')
  const inputs = await server.ssrLoadModule('/src/generation/inputs.ts')
  const settings = { ...(await server.ssrLoadModule('/src/font/settings.ts')).DEFAULT_COMPOSITION_SETTINGS, ...project.compositionSettings }
  const generation = inputs.buildGenerationInputs(project.drawings, project.writingSessions, settings)
  const request = {
    type: 'compose-font', ...generation, compositionSettings: settings,
    metadata: { familyName: 'Golden', styleName: 'Regular', designer: '', version: '1.0' },
    overrides: { 0xac00: { left: 10, right: -5, y: 12, scale: 1.1, rotation: 3 } }, globalMetrics: { left: 4, right: 6, y: 2 }, unitsPerEm: 1000,
  }
  const prepared = builder.prepareCompositionContext(request)
  const syllables = {}
  for (const codePoint of new Set([...REQUIRED, ...MATRIX, ...stride])) {
    const result = builder.composedHangulParts(codePoint, prepared.shapes, request, prepared.visualScale)
    syllables[String.fromCodePoint(codePoint)] = { commands: result.path.commands, geometry: result.geometry }
  }
  // Only the sampled syllables are composed inside the font; the rest are empty.
  const hangulSource = (codePoint) => structuredClone(syllables[String.fromCodePoint(codePoint)]?.commands ?? [])
  const { buffer, glyphCount } = await builder.composeFont(request, { cancelled: () => false, progress: () => {}, hangulSource, preparedContext: prepared })
  const font = opentype.parse(buffer)
  const glyphs = {}
  for (let index = 0; index < font.glyphs.length; index += 1) {
    const glyph = font.glyphs.get(index)
    if (glyph.path.commands.length) glyphs[glyph.name] = { advanceWidth: glyph.advanceWidth, commands: glyph.path.commands }
  }
  const { drawings, ...profile } = generation
  const result = { visualScale: prepared.visualScale, shapeKeys: [...prepared.shapes.keys()].sort(), profile, glyphCount, syllables, glyphs }
  writeOut(out, JSON.stringify(result))
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
  console.log(`${out}: all=${hash(result)} syllables=${hash(syllables)} glyphs=${hash(glyphs)} profile=${hash(profile)} shapes=${prepared.shapes.size} glyphs=${Object.keys(glyphs).length}`)
} finally { await server.close() }
