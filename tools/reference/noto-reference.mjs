// node tools/reference/noto-reference.mjs
// Local Noto geometry is diagnostic reference data, never a runtime fitting target.
import { writeOut } from '../lib/out.mjs'
import { loadNoto, opentype } from '../lib/noto.mjs'
import { startVite } from '../lib/vite.mjs'
export const { font: noto } = loadNoto()
const server = await startVite()
const { decomposeHangul } = await server.ssrLoadModule('/src/font/hangul.ts')
await server.close()
const union = boxes => ({ x1: Math.min(...boxes.map(b => b.x1)), x2: Math.max(...boxes.map(b => b.x2)), y1: Math.min(...boxes.map(b => b.y1)), y2: Math.max(...boxes.map(b => b.y2)) })
const cx = b => (b.x1 + b.x2) / 2
const cy = b => (b.y1 + b.y2) / 2
function contours(char) {
  const paths = []
  for (const c of noto.charToGlyph(char).getPath(0, 0, 1000).commands) {
    if (c.type === 'M') paths.push(new opentype.Path())
    paths.at(-1)?.commands.push(c)
  }
  return paths.filter(p => p.commands.length).map(p => p.getBoundingBox())
}
const counts = new Map()
const contourCount = char => {
  if (!char) return 0
  if (!counts.has(char)) counts.set(char, contours(char).length)
  return counts.get(char)
}
/** Reject ambiguous topology rather than treating the last contour as a role. */
export function notoRoles(char) {
  const { chars, kind } = decomposeHangul(char.codePointAt(0))
  const boxes = contours(char)
  const ni = contourCount(chars.initial); const nm = contourCount(chars.medial); const nf = contourCount(chars.final)
  if (!ni || !nm || boxes.length !== ni + nm + nf) return undefined
  const body = union(boxes)
  let remaining = boxes.slice()
  let stems = []
  if (kind === 'mixed') {
    stems = remaining.filter(b => cx(b) > body.x1 + (body.x2 - body.x1) * 0.55 && b.y2 - b.y1 > (body.y2 - body.y1) * 0.35 && b.x2 - b.x1 < (b.y2 - b.y1) * 0.5)
    if (!stems.length || stems.length >= nm) return undefined
    remaining = remaining.filter(b => !stems.includes(b))
  }
  const lower = nf ? remaining.slice().sort((a, b) => cy(b) - cy(a)).slice(0, nf) : []
  remaining = remaining.filter(b => !lower.includes(b))
  const initial = remaining.slice().sort(kind === 'vertical' ? (a, b) => cx(a) - cx(b) : (a, b) => cy(a) - cy(b)).slice(0, ni)
  const medial = [...stems, ...remaining.filter(b => !initial.includes(b))]
  if (initial.length !== ni || medial.length !== nm) return undefined
  const i = union(initial); const m = union(medial); const f = lower.length ? union(lower) : undefined
  // Entire role bounds must have the expected order. Holes remain with their outlines.
  if (kind === 'vertical' ? i.x2 >= m.x1 : kind !== 'mixed' && i.y2 >= m.y1) return undefined
  if (f && (f.y1 < i.y2 || (kind !== 'mixed' && f.y1 < m.y2))) return undefined
  const h = kind === 'mixed' ? union(medial.filter(b => !stems.includes(b))) : undefined
  if (h && (i.y2 >= h.y1 || (f && f.y1 < h.y2))) return undefined
  return { body, initial: i, medial: m, ...(f ? { final: f } : {}), ...(h ? { medialH: h, medialV: union(stems) } : {}) }
}
export function writeNotoReference() {
  const groups = new Map()
  for (let cp = 0xac00; cp <= 0xd7a3; cp++) {
    const char = String.fromCodePoint(cp); const result = notoRoles(char)
    if (!result) continue
    const { vowelIndex, finalIndex, chars } = decomposeHangul(cp)
    const key = `${vowelIndex}:${!finalIndex ? 'none' : [...'ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ'].includes(chars.final) ? 'compound' : 'single'}`
    const { body, ...parts } = result
    const sample = Object.fromEntries(Object.entries(parts).map(([role, b]) => [role, { x1: (b.x1 - body.x1) / (body.x2 - body.x1), x2: (b.x2 - body.x1) / (body.x2 - body.x1), y1: (b.y1 - body.y1) / (body.y2 - body.y1), y2: (b.y2 - body.y1) / (body.y2 - body.y1) }]))
    groups.set(key, [...(groups.get(key) ?? []), sample])
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const table = Object.fromEntries([...groups].map(([key, samples]) => [key, { count: samples.length, ...Object.fromEntries(Object.keys(samples[0]).map(role => [role, Object.fromEntries(['x1', 'y1', 'x2', 'y2'].map(axis => [axis, Math.round(median(samples.map(s => s[role][axis])) * 1000) / 1000]))])) }]))
  writeOut('noto-space-reference.json', JSON.stringify({ description: 'Spatial reference only; ambiguous glyphs excluded; no width/height/aspect targets.', measured: [...groups.values()].reduce((n, s) => n + s.length, 0), classes: table }, null, 2))
  console.log(`Noto reference: ${Object.keys(table).length} classes, ${[...groups.values()].reduce((n, s) => n + s.length, 0)} accepted glyphs`)
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/reference/noto-reference.mjs')) writeNotoReference()
