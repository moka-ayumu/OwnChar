// node tools/verify/validate-layout.mjs [--revision=HEAD] [--all] [--out=layout-audit]
import { MATRIX, REQUIRED, hasNonFinite } from '../lib/glyphs.mjs'
import { writeOut } from '../lib/out.mjs'
import { loadProject } from '../lib/project.mjs'
import { startVite } from '../lib/vite.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const revision = option('revision', '')
const name = option('out', revision ? 'head-audit' : 'layout-audit')
const project = loadProject()
const server = await startVite({ revision })
try {
  const composer = await server.ssrLoadModule('/src/generation/font-builder.ts')
  const inputs = await server.ssrLoadModule('/src/generation/inputs.ts')
  const hangul = await server.ssrLoadModule('/src/font/layout/compose-syllable.ts')
  const collision = await server.ssrLoadModule('/src/font/geometry/collision.ts')
  const t0 = performance.now()
  const request = { ...inputs.buildGenerationInputs(project.drawings, project.writingSessions ?? {}, project.compositionSettings), compositionSettings: project.compositionSettings }
  const context = composer.prepareCompositionContext(request)
  const prepareMs = performance.now() - t0
  const list = args.includes('--all') ? Array.from({ length: 11172 }, (_, i) => 0xac00 + i) : [...new Set([...REQUIRED, ...MATRIX])]
  const entries = {}
  const failures = []
  const stored = new Set([...REQUIRED, ...MATRIX])
  const stats = { revision: revision || 'working-tree', count: list.length, prepareMs: Math.round(prepareMs), composeMs: 0, renderMs: 0, invalid: 0, overflow: 0, collisions: 0, missing: 0, misordered: 0 }
  const start = performance.now()
  for (let index = 0; index < list.length; index++) {
    const cp = list[index]
    const char = String.fromCodePoint(cp)
    // Older revisions have no composedHangulParts.
    const hasParts = Boolean(composer.composedHangulParts)
    const renderStart = performance.now()
    const result = hasParts ? composer.composedHangulParts(cp, context.shapes, request, context.visualScale)
      : hangul.composeHangulParts(cp, context.shapes, request.compositionSettings, composer.hangulComposeOptions(request, context.visualScale))
    const pathStart = performance.now()
    const path = hasParts ? result.path : composer.composedHangulPath(cp, context.shapes, request, context.visualScale)
    stats.renderMs += performance.now() - (hasParts ? renderStart : pathStart)
    const b = path.getBoundingBox()
    const invalid = hasNonFinite(path.commands)
    const overflow = b.x1 < -0.1 || b.x2 > 1000.1 || b.y1 < -150.1 || b.y2 > 900.1
    const active = Object.entries(result.parts).filter(([, part]) => part.commands.length)
    const overlaps = []
    for (let a = 0; a < active.length; a++) for (let j = a + 1; j < active.length; j++) {
      const [first, pa] = active[a]
      const [second, pb] = active[j]
      // Area of the actual filled outlines; bbox overlap alone is not a failure.
      const area = collision.inkIntersectionArea(pa, pb)
      if (area > 0.5) overlaps.push({ pair: `${first}:${second}`, area: Math.round(area * 10) / 10 })
    }
    const expected = (cp - 0xac00) % 28 ? 3 : 2
    const missing = active.length !== expected
    const roleBoxes = Object.fromEntries(active.map(([role, p]) => { const box = p.getBoundingBox(); return [role, { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 }] }))
    // Reading order: the final sits below both upper jamo, and under a
    // horizontal vowel the initial sits above the vowel.
    const midY = (role) => roleBoxes[role] && (roleBoxes[role].y1 + roleBoxes[role].y2) / 2
    const vowel = Math.floor((cp - 0xac00) % 588 / 28)
    const misordered = Boolean((roleBoxes.final && ['initial', 'medial'].some((role) => roleBoxes[role] && midY('final') >= midY(role)))
      || ([8, 12, 13, 17, 18].includes(vowel) && roleBoxes.initial && roleBoxes.medial && midY('initial') <= midY('medial')))
    stats.invalid += Number(invalid)
    stats.overflow += Number(overflow)
    stats.collisions += Number(overlaps.length > 0)
    stats.missing += Number(missing)
    stats.misordered += Number(misordered)
    const failed = invalid || overflow || overlaps.length || missing || misordered
    const entry = { commands: path.commands, parts: Object.fromEntries(active.map(([role, p]) => [role, p.commands])), boxes: roleBoxes, geometry: result.geometry, overlaps }
    if (stored.has(cp) || (failures.length < 60 && failed)) entries[char] = entry
    if (failed) failures.push({ char, invalid, overflow, missing, misordered, overlaps })
    if (index && index % 2000 === 0) console.log(`${revision || 'current'}: ${index}/${list.length}`)
  }
  stats.composeMs = Math.round(performance.now() - start)
  stats.renderMs = Math.round(stats.renderMs)
  writeOut(`${name}.json`, JSON.stringify({ stats, required: REQUIRED.map((cp) => String.fromCodePoint(cp)), matrix: MATRIX.map((cp) => String.fromCodePoint(cp)), failures, entries }))
  console.log(JSON.stringify(stats, null, 2))
} finally { await server.close() }
