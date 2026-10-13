// Used by tools/sample/generate.mjs; not a script.
// Synthetic handwriting: jamo and letter skeletons, syllable layout, and pen distortion.
// All skeletons are polylines. Hangul uses a unit em box (x right, y down). Latin uses cap-height units.

export const CELL = 148

/**
 * The writer's constant habits. slant: letters lean right. rise: horizontal strokes rise to the right.
 * corner: how round a corner is. bow: how much a straight stroke curves by itself. squat, closed, flat: height for width.
 * plump: how much a consonant swells outward. arc: how much the strokes of a vowel curve together.
 * pen: stroke width setting. minimum: least distance between two jamo, in pixels.
 */
export const STYLES = {
  tidy: { slant: 0.07, rise: 0.045, latinSlant: 0.1, corner: 0.1, sharp: 0.02, bow: 0, hangulBow: 0, squat: 1, closed: 1.15, flat: 0.94, spread: 0, gapOpen: 0, gapSide: 0, gapMixed: 0, gapFinal: 0, sideRoom: 0, headroom: 0, finalTrim: 0, roundRing: false, lineJitter: 0, drift: 1, cornerVary: 0, plump: 0, arc: 0, hangulWave: 1, finalRoom: 0, pairFull: false, joined: false, handRing: false, gap: 0, cornerShare: 0.4, flatCorner: 1, uprightTick: false, turn: 2, hangulTurn: 2, bounce: 2.2, size: 64, capHeight: 46, pen: 0.5, minimum: 6 },
  example: { slant: -0.015, rise: 0.012, latinSlant: 0, corner: 0.3, sharp: 0.12, bow: 0.055, hangulBow: 0, squat: 1, closed: 1.3, flat: 1.12, spread: 0.05, gapOpen: 16, gapSide: 13, gapMixed: 13, gapFinal: 13, sideRoom: 0.08, headroom: 0.1, finalTrim: 0.07, roundRing: true, lineJitter: 0.8, drift: 0.25, cornerVary: 0.6, plump: 0, arc: 0, hangulWave: 0, finalRoom: 0.025, pairFull: true, joined: true, handRing: true, gap: 10, cornerShare: 0.3, flatCorner: 0.6, uprightTick: true, turn: 3.2, hangulTurn: 1.6, bounce: 1.5, size: 66, capHeight: 46, pen: 0.5, minimum: 6.4 },
}
let style = STYLES.tidy
export function useStyle(name) {
  if (!STYLES[name]) throw new Error(`no style ${name}`)
  style = STYLES[name]
  return style
}

export function createRng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next())
  return { next, gauss: () => Math.max(-2, Math.min(2, gauss())) }
}

const rad = (deg) => deg * Math.PI / 180

/** Elliptic arc. Angles in degrees, clockwise on screen from the +x axis. */
const ell = (cx, cy, rx, ry, a0, a1) => {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 9))
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = rad(a0 + (a1 - a0) * i / n)
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]
  })
}

const q = (p0, c, p1, n = 12) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n
  const u = 1 - t
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]
})

/** Polyline with rounded corners. */
let cornerScale = 1
let boxAspect = 1
const pl = (pts, r = style.corner * cornerScale) => {
  if (pts.length < 3) return pts.map((p) => [...p])
  const out = [[...pts[0]]]
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
    const la = Math.hypot(a[0] - b[0], a[1] - b[1])
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1])
    // A hand does not round every corner the same.
    const vary = style.cornerVary ? 1 - style.cornerVary * ringNoise() : 1
    const d = Math.min(r * vary, la * style.cornerShare, lc * style.cornerShare)
    const p0 = [b[0] + (a[0] - b[0]) * d / la, b[1] + (a[1] - b[1]) * d / la]
    const p1 = [b[0] + (c[0] - b[0]) * d / lc, b[1] + (c[1] - b[1]) * d / lc]
    out.push(...q(p0, b, p1, 5))
  }
  out.push([...pts.at(-1)])
  return out
}

/** Catmull-Rom spline through the points. */
const sp = (pts, n = 8) => {
  const out = []
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let k = 0; k < n; k += 1) {
      const t = k / n
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (p2[d] - p0[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t * t + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * t * t * t)))
    }
  }
  out.push([...pts.at(-1)])
  return out
}

const cat = (...parts) => parts.flatMap((part, i) => i ? part.slice(Math.hypot(part[0][0] - parts[i - 1].at(-1)[0], part[0][1] - parts[i - 1].at(-1)[1]) < 1e-6 ? 1 : 0) : part)

const inBox = (strokes, box) => strokes.map((s) => s.map(([x, y]) => [box.x0 + x * (box.x1 - box.x0), box.y0 + y * (box.y1 - box.y0)]))

/** The same polyline with no segment longer than `step`, so a warp bends its straight parts. */
const densify = (points, step = 0.03) => points.flatMap((point, i) => {
  if (!i) return [point]
  const [x0, y0] = points[i - 1]
  const n = Math.max(1, Math.ceil(Math.hypot(point[0] - x0, point[1] - y0) / step))
  return Array.from({ length: n }, (_, k) => k === n - 1 ? point : [x0 + (point[0] - x0) * (k + 1) / n, y0 + (point[1] - y0) * (k + 1) / n])
})

/** Swells the strokes of a consonant outward from the middle of its box. One field moves all strokes, so strokes that touch stay together. */
function plump(strokes, box) {
  const k = style.plump
  if (!k) return strokes
  const w = box.x1 - box.x0; const h = box.y1 - box.y0
  const cx = (box.x0 + box.x1) / 2; const cy = (box.y0 + box.y1) / 2
  const fit = 1 / (1 + k / 2)
  return strokes.map((stroke) => densify(stroke).map(([x, y]) => {
    const u = (x - box.x0) / w; const v = (y - box.y0) / h
    return [cx + ((x - cx) + k * w * (u - 0.5) * 2 * Math.sin(Math.PI * Math.max(0, Math.min(1, v)))) * fit, cy + ((y - cy) + k * h * (v - 0.5) * 2 * Math.sin(Math.PI * Math.max(0, Math.min(1, u)))) * fit]
  }))
}

/** Curves the strokes of a vowel together: stems lean out in the middle and bars sag. */
function arc(strokes) {
  const k = style.arc
  if (!k || !strokes.length) return strokes
  const all = strokes.flat()
  const x0 = Math.min(...all.map((p) => p[0])); const x1 = Math.max(...all.map((p) => p[0]))
  const y0 = Math.min(...all.map((p) => p[1])); const y1 = Math.max(...all.map((p) => p[1]))
  const w = x1 - x0; const h = y1 - y0
  return strokes.map((stroke) => densify(stroke).map(([x, y]) => [
    x + (h > 0.2 ? k * (Math.sin(Math.PI * (y - y0) / h) - 0.5) : 0),
    y + (w > 0.2 ? k * (Math.sin(Math.PI * (x - x0) / w) - 0.5) : 0),
  ]))
}

// ---------------------------------------------------------------- consonants

let ringSeed = 1
const ringNoise = () => (ringSeed = ringSeed * 16807 % 2147483647) / 2147483647

/** A circle as a hand draws it: a little oval, never the same twice, and the end runs past the start on the inside. */
function ring(cx, cy, rx, ry) {
  if (!style.handRing) return ell(cx, cy, rx, ry, -100, -460)
  const oval = (style.roundRing ? 0.008 : 0.03) + (style.roundRing ? 0.014 : 0.04) * ringNoise(); const ovalAt = 360 * ringNoise()
  const lobe = 0.012 + 0.02 * ringNoise(); const lobeAt = 360 * ringNoise()
  const sweep = 368 + 10 * ringNoise()
  return Array.from({ length: 47 }, (_, i) => {
    const t = i / 46
    const a = -100 - sweep * t
    const tuck = t > 0.85 ? 1 - 0.07 * (t - 0.85) / 0.15 : 1
    const m = (1 + oval * Math.cos(rad(2 * (a - ovalAt))) + lobe * Math.cos(rad(3 * (a - lobeAt)))) * tuck
    return [cx + rx * m * Math.cos(rad(a)), cy + ry * m * Math.sin(rad(a))]
  })
}

/** Consonants written without lifting the pen where two strokes meet in a corner, so the corner is round. They have fewer strokes than usual. */
const JOINED = {
  ㄷ: () => [pl([[0.92, 0.1], [0.1, 0.1], [0.1, 0.9], [0.96, 0.88]], style.corner * 0.45)],
  ㅌ: () => [pl([[0.92, 0.08], [0.1, 0.08], [0.1, 0.92], [0.96, 0.9]], style.corner * 0.45), pl([[0.1, 0.49], [0.86, 0.49]])],
  ㄹ: () => [pl([[0.06, 0.08], [0.9, 0.08], [0.9, 0.48], [0.09, 0.48], [0.09, 0.92], [0.97, 0.9]], style.corner * 0.45)],
  // The hand-shake correction of the app smooths a small closed loop into a circle unless its corners are tight (about 2.5 pixels or less).
  ㅁ: () => [pl([[0.1, 0.1], [0.1, 0.92], [0.92, 0.92], [0.92, 0.1], [0.1, 0.1]], 0.085)],
  ㅅ: () => [pl([[0.04, 0.96], [0.5, 0.05], [0.97, 0.95]], 0.05)],
  ㅈ: () => [pl([[0.06, 0.12], [0.94, 0.12]]), pl([[0.04, 0.97], [0.5, 0.12], [0.97, 0.95]], 0.05)],
  ㅂ: () => [pl([[0.12, 0.04], [0.12, 0.93], [0.88, 0.93], [0.88, 0.04]]), pl([[0.12, 0.47], [0.88, 0.47]])],
}

/** Strokes of a single consonant in a unit box. `ctx`: 'side' (left of a vertical vowel), 'top', or 'final'. */
function singleConsonant(ch, ctx) {
  cornerScale = ctx === 'side' ? 1 : style.flatCorner
  if (style.joined && JOINED[ch]) return JOINED[ch]()
  const side = ctx === 'side'
  const jieut = style.joined ? JOINED.ㅈ() : [pl([[0.06, 0.12], [0.94, 0.12]]), q([0.53, 0.12], [0.46, 0.6], [0.04, 0.97]), q([0.46, 0.46], [0.62, 0.78], [0.97, 0.95])]
  switch (ch) {
    case 'ㄱ': return side ? [cat(pl([[0.05, 0.12], [0.93, 0.12]]), q([0.93, 0.12], [0.9, 0.62], [0.4, 0.98]))] : [pl([[0.06, 0.12], [0.93, 0.12], [0.87, 0.96]])]
    case 'ㄴ': return [pl([[0.1, 0.04], [0.1, 0.9], [0.96, side ? 0.82 : 0.88]])]
    case 'ㄷ': return [pl([[0.06, 0.1], [0.92, 0.1]]), pl([[0.1, 0.1], [0.1, 0.9], [0.96, side ? 0.84 : 0.88]])]
    case 'ㄹ': return [pl([[0.06, 0.08], [0.9, 0.08], [0.9, 0.48]]), pl([[0.09, 0.48], [0.9, 0.48]]), pl([[0.09, 0.48], [0.09, 0.92], [0.97, side ? 0.87 : 0.9]])]
    case 'ㅁ': return [pl([[0.1, 0.08], [0.1, 0.94]]), pl([[0.1, 0.1], [0.92, 0.1], [0.9, 0.93]]), pl([[0.1, 0.92], [0.92, 0.92]])]
    case 'ㅂ': return [pl([[0.12, 0.04], [0.12, 0.95]]), pl([[0.88, 0.04], [0.88, 0.95]]), pl([[0.12, 0.47], [0.88, 0.47]]), pl([[0.12, 0.93], [0.88, 0.93]])]
    case 'ㅅ': return [q([0.5, 0.05], [0.44, 0.6], [0.04, 0.96]), q([0.46, 0.4], [0.62, 0.76], [0.97, 0.95])]
    case 'ㅇ': return [ring(0.5, 0.5, 0.47, 0.47)]
    case 'ㅈ': return jieut
    case 'ㅊ': return [style.uprightTick ? pl([[0.5, 0], [0.5, 0.296]]) : pl([[0.4, 0.0], [0.56, 0.12]]), ...inBox(jieut, { x0: 0, x1: 1, y0: 0.2, y1: 1 })]
    case 'ㅋ': return [...singleConsonant('ㄱ', ctx), side ? pl([[0.1, 0.52], [0.74, 0.47]]) : pl([[0.08, 0.53], [0.88, 0.53]])]
    case 'ㅌ': return [pl([[0.06, 0.08], [0.92, 0.08]]), pl([[0.1, 0.48], [0.86, 0.48]]), pl([[0.1, 0.08], [0.1, 0.92], [0.96, side ? 0.86 : 0.9]])]
    case 'ㅍ': return [pl([[0.04, 0.1], [0.96, 0.1]]), pl([[0.3, 0.1], [0.33, 0.9]]), pl([[0.7, 0.1], [0.67, 0.9]]), pl([[0.02, 0.9], [0.98, 0.9]])]
    case 'ㅎ': return style.uprightTick
      ? [pl([[0.5, 0], [0.5, 0.2]]), pl([[0.04, 0.2], [0.96, 0.2]]), ring(0.5, 0.7, style.roundRing ? Math.min(0.42, 0.3 / boxAspect) : 0.3, style.roundRing ? 0.3 : 0.26)]
      : [pl([[0.36, 0.03], [0.64, 0.03]]), pl([[0.04, 0.27], [0.96, 0.27]]), ring(0.5, 0.7, 0.31, 0.29)]
    default: throw new Error(`no consonant ${ch}`)
  }
}

const PAIRS = {
  ㄲ: 'ㄱㄱ', ㄸ: 'ㄷㄷ', ㅃ: 'ㅂㅂ', ㅆ: 'ㅅㅅ', ㅉ: 'ㅈㅈ',
  ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
}

/** Width for height a consonant is written with, as [narrowest, widest]. */
const ASPECT = {
  ㄱ: [0.8, 1.3], ㄴ: [0.9, 1.5], ㄷ: [0.9, 1.5], ㄹ: [0.7, 1.15], ㅁ: [0.85, 1.2], ㅂ: [0.75, 1.1], ㅅ: [0.9, 1.5],
  ㅇ: [0.88, 1.12], ㅈ: [0.85, 1.4], ㅊ: [0.72, 1.15], ㅋ: [0.8, 1.3], ㅌ: [0.8, 1.3], ㅍ: [0.95, 1.5], ㅎ: [0.72, 1.1],
}
const BOXY = new Set([...'ㅇㅁㅂㅎㅊㄹ'])

/** Strokes of a consonant fitted into `region` of the em box, keeping a natural width for its height. */
function consonant(ch, ctx, region, yScale, shape = ctx) {
  const pair = PAIRS[ch]
  const base = pair ? pair[0] : ch
  const widen = ctx === 'side' ? 1 : BOXY.has(base) ? (ctx === 'top' ? 1.15 : 1.45) : (ctx === 'top' ? 1.35 : 1.65)
  const count = pair ? 1.9 : 1
  // A hand draws ㅇ as a circle wherever it stands, not as an oval that fills its place.
  const [narrow, wide] = base === 'ㅇ' && style.roundRing ? [0.96 * count, 1.04 * count] : ASPECT[base].map((value, bound) => value * count * (pair && style.pairFull && !bound ? 1 : widen))
  let { x0, y0, x1, y1 } = region
  const aspect = (x1 - x0) / ((y1 - y0) * yScale)
  if (aspect > wide) {
    const width = (y1 - y0) * yScale * wide
    const center = (x0 + x1) / 2
    x0 = center - width / 2; x1 = center + width / 2
  } else if (aspect < narrow) {
    const height = (x1 - x0) / narrow / yScale
    const anchor = ctx === 'final' ? 0 : ctx === 'top' ? 0.6 : 0.45
    const top = y0 + (y1 - y0 - height) * anchor
    y0 = top; y1 = top + height
  }
  const box = { x0, y0, x1, y1 }
  boxAspect = (x1 - x0) * (pair ? 0.46 : 1) / ((y1 - y0) * yScale)
  if (!pair) return plump(inBox(singleConsonant(ch, shape), box), box)
  const half = (x1 - x0) * 0.46
  return [
    ...plump(inBox(singleConsonant(pair[0], shape), { ...box, x1: x0 + half }), { ...box, x1: x0 + half }),
    ...plump(inBox(singleConsonant(pair[1], shape), { ...box, x0: x1 - half }), { ...box, x0: x1 - half }),
  ]
}

// -------------------------------------------------------------------- vowels

const MIXED = { ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ' }

/** A vertical vowel with its main stem at `X`. `tick` overrides the height and the start of the ticks. Returns the strokes and their left edge. */
function verticalPart(v, X, y0, y1, tick) {
  const stem = (x, inset = 0) => pl([[x + 0.012, y0 + inset], [x, y1 - inset * 0.5]])
  const at = (f) => tick?.y ?? y0 + (y1 - y0) * f
  const bar = (from, to, f) => pl([[tick?.from ?? from, at(f) + 0.008], [to, at(f)]])
  switch (v) {
    case 'ㅏ': return { strokes: [stem(X), bar(X, X + 0.2, 0.5)], left: X }
    case 'ㅑ': return { strokes: [stem(X), bar(X, X + 0.2, 0.38), bar(X, X + 0.2, 0.62)], left: X }
    case 'ㅓ': return { strokes: [bar(X - 0.22, X, 0.5), stem(X)], left: X - 0.22 }
    case 'ㅕ': return { strokes: [bar(X - 0.22, X, 0.38), bar(X - 0.22, X, 0.62), stem(X)], left: X - 0.22 }
    case 'ㅣ': return { strokes: [stem(X)], left: X }
    case 'ㅐ': return { strokes: [stem(X - 0.1, 0.05), pl([[X - 0.1, at(0.5) + 0.008], [X + 0.11, at(0.5)]]), stem(X + 0.11)], left: X - 0.1 }
    case 'ㅒ': return { strokes: [stem(X - 0.1, 0.05), pl([[X - 0.1, at(0.38) + 0.008], [X + 0.11, at(0.38)]]), pl([[X - 0.1, at(0.62) + 0.008], [X + 0.11, at(0.62)]]), stem(X + 0.11)], left: X - 0.1 }
    case 'ㅔ': return { strokes: [bar(X - 0.26, X - 0.1, 0.5), stem(X - 0.1, 0.05), stem(X + 0.11)], left: X - 0.26 }
    case 'ㅖ': return { strokes: [bar(X - 0.26, X - 0.1, 0.38), bar(X - 0.26, X - 0.1, 0.62), stem(X - 0.1, 0.05), stem(X + 0.11)], left: X - 0.26 }
    default: throw new Error(`no vertical vowel ${v}`)
  }
}

/** A horizontal vowel: its bar at `barY` from x0 to x1, and its short strokes of length `len`. */
function horizontalPart(h, x0, x1, barY, len) {
  const bar = pl([[x0, barY + 0.012], [x1, barY - 0.012]])
  const at = (f) => x0 + (x1 - x0) * f
  switch (h) {
    case 'ㅗ': return [pl([[at(0.5), barY - len], [at(0.5) - 0.01, barY]]), bar]
    case 'ㅛ': return [pl([[at(0.34), barY - len], [at(0.35), barY]]), pl([[at(0.66), barY - len], [at(0.65), barY]]), bar]
    case 'ㅜ': return [bar, pl([[at(0.5), barY], [at(0.5) - 0.01, barY + len]])]
    case 'ㅠ': return [bar, pl([[at(0.37), barY], [at(0.33), barY + len * 0.9]]), pl([[at(0.64), barY], [at(0.64), barY + len]])]
    case 'ㅡ': return [bar]
    default: throw new Error(`no horizontal vowel ${h}`)
  }
}

const STEM_X = { ㅏ: 0.76, ㅑ: 0.76, ㅓ: 0.86, ㅕ: 0.86, ㅣ: 0.78, ㅐ: 0.8, ㅒ: 0.8, ㅔ: 0.83, ㅖ: 0.83 }
const MIXED_STEM_X = { ㅏ: 0.79, ㅐ: 0.81, ㅣ: 0.83, ㅓ: 0.84, ㅔ: 0.82 }

/**
 * The jamo of one syllable in the em box, per role, with the vertical stretch of the syllable.
 * `chars` and `kind` come from `decomposeHangul`.
 */
export function syllableSkeleton({ chars, kind }) {
  const { initial, medial, final } = chars
  const closed = Boolean(final)
  const yScale = (closed ? style.closed : kind === 'vertical' ? 1 : style.flat) * style.squat
  const parts = { initial: [], medial: [], final: [] }
  if (kind === 'vertical') {
    const vowel = verticalPart(medial, STEM_X[medial], closed ? 0 : 0.02, closed ? 0.57 - style.finalRoom : 0.98)
    parts.medial = vowel.strokes
    const right = Math.min(0.6, vowel.left - 0.12)
    parts.initial = consonant(initial, 'side', closed ? { x0: 0.08 - style.sideRoom, x1: right, y0: 0.03, y1: 0.47 } : { x0: 0.04 - style.sideRoom, x1: right, y0: 0.16, y1: 0.8 }, yScale)
    if (closed) parts.final = consonant(final, 'final', { x0: 0.2 + style.finalTrim, x1: 0.94 - style.finalTrim, y0: 0.69 - style.finalRoom, y1: 0.98 + style.finalRoom / 2 - style.finalTrim * 0.7 }, yScale)
  } else if (kind !== 'mixed') {
    const up = medial === 'ㅗ' || medial === 'ㅛ'
    const flat = medial === 'ㅡ'
    if (!closed) {
      parts.initial = consonant(initial, 'top', { x0: 0.2, x1: 0.8, y0: (flat ? 0.1 : up ? 0.04 : 0.02) - style.headroom, y1: flat ? 0.58 : up ? 0.5 : 0.44 }, yScale)
      parts.medial = horizontalPart(medial, 0.03, 0.97, (flat ? 0.75 : up ? 0.84 : 0.58) + style.spread, up ? 0.22 : 0.4)
    } else {
      parts.initial = consonant(initial, 'top', { x0: 0.22, x1: 0.78, y0: (flat ? 0.02 : 0) - style.headroom, y1: flat ? 0.36 : up ? 0.28 : 0.27 }, yScale)
      parts.medial = horizontalPart(medial, 0.05, 0.95, flat ? 0.5 : up ? 0.52 : 0.39, up ? 0.14 : 0.16)
      parts.final = consonant(final, 'final', { x0: 0.2, x1: 0.82, y0: flat ? 0.63 : up ? 0.65 : 0.68, y1: 0.98 }, yScale)
    }
  } else {
    const [h, v] = MIXED[medial]
    const X = MIXED_STEM_X[v]
    const up = h === 'ㅗ'
    const flat = h === 'ㅡ'
    const barY = closed ? (flat ? 0.46 : up ? 0.48 : 0.37) : (flat ? 0.76 : up ? 0.78 : 0.6)
    const len = closed ? (up ? 0.12 : 0.18) : (up ? 0.16 : 0.34)
    // The tick of ㅓ and ㅔ goes under the bar of ㅜ, to the right of its stem.
    const tick = up || flat ? undefined : { y: barY + (closed ? 0.12 : 0.18), from: v === 'ㅓ' ? 0.5 : 0.48 }
    const vowel = verticalPart(v, X, closed ? 0 : 0.02, closed ? 0.58 : 0.98, tick)
    const stemLeft = v === 'ㅓ' ? X : v === 'ㅔ' ? X - 0.1 : vowel.left
    const barRight = Math.min(flat ? 0.68 : 0.64, stemLeft - 0.11)
    parts.medial = [...horizontalPart(h, 0.03, barRight, barY, len), ...vowel.strokes]
    const right = Math.min(0.56, stemLeft - 0.13)
    parts.initial = consonant(initial, 'side', closed
      ? { x0: 0.08, x1: right, y0: -style.headroom, y1: up ? 0.25 : 0.27 }
      : { x0: 0.05, x1: right, y0: flat ? 0.1 : 0.05, y1: flat ? 0.6 : up ? 0.5 : 0.48 }, yScale, 'top')
    if (closed) parts.final = consonant(final, 'final', { x0: 0.2 + style.finalTrim, x1: 0.94 - style.finalTrim, y0: 0.7, y1: 0.98 - style.finalTrim * 0.7 }, yScale)
  }
  parts.medial = arc(parts.medial)
  return { parts, yScale }
}

// --------------------------------------------------------------------- latin

const scaleX = (w, strokes) => strokes.map((s) => s.map(([x, y]) => [x * w, y]))
const dot = (x, y, w) => ell(x, y, 0.035 / w, 0.035, 0, 420)
const sharp = () => style.sharp
const bowlS = (top, mid, bottom) => cat(ell(0.5, (top + mid) / 2, 0.44, (mid - top) / 2, -30, -270), ell(0.5, (mid + bottom) / 2, 0.47, (bottom - mid) / 2, -90, 150))

/** Letters, digits and symbols. y: 0 cap top, 1 baseline, 0.42 x-height. Each entry is [width, strokes in a unit-wide box]. */
const LATIN = {
  A: [0.75, () => [pl([[0.5, 0], [0, 1]]), pl([[0.5, 0], [1, 1]]), pl([[0.18, 0.64], [0.82, 0.64]])]],
  B: [0.6, () => [pl([[0, 0], [0, 1]]), cat(pl([[0, 0], [0.45, 0]]), ell(0.45, 0.25, 0.5, 0.25, -90, 90), ell(0.48, 0.75, 0.52, 0.25, -90, 90), pl([[0.48, 1], [0, 1]]))]],
  C: [0.7, () => [ell(0.55, 0.5, 0.55, 0.5, -45, -315)]],
  D: [0.7, () => [pl([[0, 0], [0, 1]]), cat(pl([[0, 0], [0.4, 0]]), ell(0.4, 0.5, 0.6, 0.5, -90, 90), pl([[0.4, 1], [0, 1]]))]],
  E: [0.6, () => [pl([[0, 0], [0, 1]]), pl([[0, 0], [1, 0]]), pl([[0, 0.5], [0.85, 0.5]]), pl([[0, 1], [1, 1]])]],
  F: [0.6, () => [pl([[0, 0], [0, 1]]), pl([[0, 0], [1, 0]]), pl([[0, 0.5], [0.85, 0.5]])]],
  G: [0.75, () => [ell(0.55, 0.5, 0.55, 0.5, -45, -360), pl([[0.62, 0.5], [1.12, 0.5], [1.12, 0.95]])]],
  H: [0.7, () => [pl([[0, 0], [0, 1]]), pl([[1, 0], [1, 1]]), pl([[0, 0.5], [1, 0.5]])]],
  I: [0.4, () => [pl([[0.5, 0], [0.5, 1]]), pl([[0.08, 0], [0.92, 0]]), pl([[0.08, 1], [0.92, 1]])]],
  J: [0.55, () => [cat(pl([[0.75, 0], [0.75, 0.72]]), ell(0.4, 0.72, 0.35, 0.28, 0, 170)), pl([[0.4, 0], [1.05, 0]])]],
  K: [0.65, () => [pl([[0, 0], [0, 1]]), pl([[0.95, 0], [0.02, 0.6]]), pl([[0.3, 0.42], [1, 1]])]],
  L: [0.6, () => [pl([[0, 0], [0, 1], [1, 1]])]],
  M: [0.9, () => [pl([[0, 1], [0, 0], [0.5, 0.75], [1, 0], [1, 1]], sharp())]],
  N: [0.7, () => [pl([[0, 1], [0, 0], [1, 1], [1, 0]], sharp())]],
  O: [0.8, () => [ell(0.5, 0.5, 0.5, 0.5, -100, -460)]],
  P: [0.6, () => [pl([[0, 0], [0, 1]]), cat(pl([[0, 0], [0.5, 0]]), ell(0.5, 0.27, 0.5, 0.27, -90, 90), pl([[0.5, 0.54], [0, 0.54]]))]],
  Q: [0.8, () => [ell(0.5, 0.5, 0.5, 0.5, -100, -460), pl([[0.55, 0.7], [1.05, 1.08]])]],
  R: [0.62, () => [pl([[0, 0], [0, 1]]), cat(pl([[0, 0], [0.5, 0]]), ell(0.5, 0.27, 0.5, 0.27, -90, 90), pl([[0.5, 0.54], [0, 0.54]])), pl([[0.4, 0.54], [1, 1]])]],
  S: [0.6, () => [bowlS(0, 0.5, 1)]],
  T: [0.7, () => [pl([[0, 0], [1, 0]]), pl([[0.5, 0], [0.5, 1]])]],
  U: [0.7, () => [cat(pl([[0, 0], [0, 0.65]]), ell(0.5, 0.65, 0.5, 0.35, 180, 0), pl([[1, 0.65], [1, 0]]))]],
  V: [0.7, () => [pl([[0, 0], [0.5, 1], [1, 0]], sharp())]],
  W: [1.0, () => [pl([[0, 0], [0.25, 1], [0.5, 0.3], [0.75, 1], [1, 0]], sharp())]],
  X: [0.7, () => [pl([[0, 0], [1, 1]]), pl([[1, 0], [0, 1]])]],
  Y: [0.7, () => [pl([[0, 0], [0.5, 0.5]]), pl([[1, 0], [0.5, 0.5], [0.5, 1]])]],
  Z: [0.7, () => [pl([[0, 0], [1, 0], [0, 1], [1, 1]], sharp())]],

  a: [0.5, () => [ell(0.45, 0.7, 0.45, 0.3, -20, -380), pl([[0.92, 0.42], [0.92, 1]])]],
  b: [0.5, () => [pl([[0, 0], [0, 1]]), ell(0.5, 0.7, 0.5, 0.3, -160, 160)]],
  c: [0.45, () => [ell(0.5, 0.7, 0.5, 0.3, -45, -315)]],
  d: [0.5, () => [ell(0.48, 0.7, 0.48, 0.3, -20, -380), pl([[0.95, 0], [0.95, 1]])]],
  e: [0.5, () => [cat(pl([[0.03, 0.7], [0.97, 0.7]]), ell(0.5, 0.7, 0.48, 0.3, 0, -300))]],
  f: [0.4, () => [cat(ell(0.7, 0.25, 0.35, 0.25, -20, -180), pl([[0.35, 0.25], [0.35, 1]])), pl([[0, 0.44], [0.8, 0.44]])]],
  g: [0.5, () => [ell(0.45, 0.7, 0.45, 0.3, -20, -380), cat(pl([[0.92, 0.42], [0.92, 1.2]]), ell(0.5, 1.2, 0.42, 0.25, 0, 150))]],
  h: [0.5, () => [pl([[0, 0], [0, 1]]), cat(ell(0.48, 0.7, 0.48, 0.28, 180, 360), pl([[0.96, 0.7], [0.96, 1]]))]],
  i: [0.2, (w) => [pl([[0.5, 0.42], [0.5, 1]]), dot(0.5, 0.2, w)]],
  j: [0.3, (w) => [cat(pl([[0.7, 0.42], [0.7, 1.2]]), ell(0.3, 1.2, 0.4, 0.22, 0, 160)), dot(0.7, 0.2, w)]],
  k: [0.5, () => [pl([[0, 0], [0, 1]]), pl([[0.85, 0.42], [0.03, 0.75]]), pl([[0.3, 0.65], [0.9, 1]])]],
  l: [0.2, () => [pl([[0.5, 0], [0.5, 1]])]],
  m: [0.8, () => [pl([[0, 0.42], [0, 1]]), cat(ell(0.25, 0.64, 0.25, 0.22, 180, 360), pl([[0.5, 0.64], [0.5, 1]])), cat(ell(0.75, 0.64, 0.25, 0.22, 180, 360), pl([[1, 0.64], [1, 1]]))]],
  n: [0.5, () => [pl([[0, 0.42], [0, 1]]), cat(ell(0.48, 0.68, 0.48, 0.26, 180, 360), pl([[0.96, 0.68], [0.96, 1]]))]],
  o: [0.5, () => [ell(0.5, 0.7, 0.5, 0.3, -100, -460)]],
  p: [0.5, () => [pl([[0, 0.42], [0, 1.45]]), ell(0.5, 0.7, 0.5, 0.3, -160, 160)]],
  q: [0.5, () => [ell(0.45, 0.7, 0.45, 0.3, -20, -380), pl([[0.92, 0.42], [0.92, 1.45]])]],
  r: [0.4, () => [pl([[0, 0.42], [0, 1]]), ell(0.5, 0.7, 0.5, 0.28, 180, 300)]],
  s: [0.42, () => [bowlS(0.42, 0.7, 1)]],
  t: [0.4, () => [cat(pl([[0.4, 0.1], [0.4, 0.8]]), ell(0.7, 0.8, 0.3, 0.2, 180, 60)), pl([[0, 0.44], [0.85, 0.44]])]],
  u: [0.5, () => [cat(pl([[0, 0.42], [0, 0.75]]), ell(0.46, 0.75, 0.46, 0.25, 180, 0), pl([[0.92, 0.75], [0.92, 0.42]])), pl([[0.92, 0.42], [0.92, 1]])]],
  v: [0.5, () => [pl([[0, 0.42], [0.5, 1], [1, 0.42]], sharp())]],
  w: [0.75, () => [pl([[0, 0.42], [0.25, 1], [0.5, 0.55], [0.75, 1], [1, 0.42]], sharp())]],
  x: [0.5, () => [pl([[0, 0.42], [1, 1]]), pl([[1, 0.42], [0, 1]])]],
  y: [0.5, () => [pl([[0, 0.42], [0.5, 1]]), pl([[1, 0.42], [0.2, 1.45]])]],
  z: [0.5, () => [pl([[0, 0.42], [1, 0.42], [0, 1], [1, 1]], sharp())]],

  0: [0.55, () => [ell(0.5, 0.5, 0.5, 0.5, -100, -460)]],
  1: [0.3, () => [pl([[0.1, 0.22], [0.6, 0], [0.6, 1]], sharp())]],
  2: [0.55, () => [cat(ell(0.5, 0.28, 0.45, 0.28, 200, 400), pl([[0.84, 0.46], [0, 1], [1, 1]], sharp()))]],
  3: [0.55, () => [cat(ell(0.45, 0.25, 0.45, 0.25, 210, 450), ell(0.45, 0.75, 0.5, 0.25, 270, 510))]],
  4: [0.6, () => [pl([[0.65, 0], [0, 0.68], [1, 0.68]], sharp()), pl([[0.7, 0.05], [0.7, 1]])]],
  5: [0.55, () => [cat(pl([[0.15, 0], [0.12, 0.45]]), ell(0.45, 0.68, 0.5, 0.3, 230, 500)), pl([[0.15, 0], [0.95, 0]])]],
  6: [0.55, () => [cat(q([0.8, 0], [0.1, 0.3], [0.05, 0.72]), ell(0.5, 0.72, 0.45, 0.28, 180, -180))]],
  7: [0.55, () => [pl([[0, 0], [1, 0], [0.4, 1]])]],
  8: [0.5, () => [cat(ell(0.5, 0.25, 0.4, 0.25, 270, 90), ell(0.5, 0.75, 0.46, 0.25, 270, 630), ell(0.5, 0.25, 0.4, 0.25, 90, -90))]],
  9: [0.5, () => [cat(ell(0.5, 0.3, 0.42, 0.3, 0, -360), pl([[0.92, 0.3], [0.85, 1]]))]],

  '.': [0.2, (w) => [dot(0.5, 0.96, w)]],
  ',': [0.2, () => [q([0.55, 0.9], [0.6, 1.02], [0.3, 1.16])]],
  '!': [0.2, (w) => [pl([[0.5, 0], [0.5, 0.7]]), dot(0.5, 0.96, w)]],
  '?': [0.5, (w) => [cat(ell(0.5, 0.25, 0.42, 0.25, 200, 450), pl([[0.5, 0.5], [0.5, 0.72]])), dot(0.5, 0.96, w)]],
  ';': [0.2, (w) => [dot(0.5, 0.5, w), q([0.55, 0.9], [0.6, 1.02], [0.3, 1.16])]],
  ':': [0.2, (w) => [dot(0.5, 0.5, w), dot(0.5, 0.96, w)]],
  "'": [0.15, () => [pl([[0.6, 0], [0.4, 0.2]])]],
  '"': [0.3, () => [pl([[0.2, 0], [0.1, 0.2]]), pl([[0.9, 0], [0.8, 0.2]])]],
  '(': [0.3, () => [q([0.9, -0.05], [-0.4, 0.52], [0.9, 1.1], 20)]],
  ')': [0.3, () => [q([0.1, -0.05], [1.4, 0.52], [0.1, 1.1], 20)]],
  '[': [0.3, () => [pl([[0.95, -0.05], [0.1, -0.05], [0.1, 1.1], [0.95, 1.1]], sharp())]],
  ']': [0.3, () => [pl([[0.05, -0.05], [0.9, -0.05], [0.9, 1.1], [0.05, 1.1]], sharp())]],
  '+': [0.55, () => [pl([[0, 0.55], [1, 0.55]]), pl([[0.5, 0.27], [0.5, 0.83]])]],
  '-': [0.4, () => [pl([[0, 0.55], [1, 0.55]])]],
  '=': [0.5, () => [pl([[0, 0.45], [1, 0.45]]), pl([[0, 0.66], [1, 0.66]])]],
  '*': [0.4, () => [pl([[0.5, 0.15], [0.5, 0.55]]), pl([[0.05, 0.25], [0.95, 0.45]]), pl([[0.95, 0.25], [0.05, 0.45]])]],
  '/': [0.45, () => [pl([[1, -0.03], [0, 1.05]])]],
  '<': [0.5, () => [pl([[1, 0.27], [0, 0.55], [1, 0.83]], sharp())]],
  '>': [0.5, () => [pl([[0, 0.27], [1, 0.55], [0, 0.83]], sharp())]],
  '@': [0.95, () => [cat(ell(0.5, 0.55, 0.2, 0.2, 0, -360), q([0.7, 0.55], [0.72, 0.8], [0.95, 0.72], 6), ell(0.5, 0.5, 0.5, 0.5, 26, -290))]],
  '#': [0.65, () => [pl([[0.38, 0.1], [0.26, 0.95]]), pl([[0.78, 0.1], [0.66, 0.95]]), pl([[0, 0.36], [1, 0.36]]), pl([[0, 0.7], [1, 0.7]])]],
  '%': [0.7, () => [ell(0.2, 0.2, 0.18, 0.18, -100, -460), pl([[0.9, 0], [0.1, 1]]), ell(0.8, 0.8, 0.18, 0.18, -100, -460)]],
  '&': [0.7, () => [sp([[0.95, 1], [0.3, 0.3], [0.28, 0.1], [0.5, 0], [0.66, 0.15], [0.5, 0.38], [0.1, 0.68], [0.12, 0.9], [0.4, 1], [0.7, 0.85], [0.95, 0.55]])]],
  $: [0.55, () => [bowlS(0.05, 0.5, 0.95), pl([[0.5, -0.1], [0.5, 1.1]])]],
  _: [0.6, () => [pl([[0, 1.1], [1, 1.1]])]],
}

export function latinSkeleton(char) {
  cornerScale = 1
  const entry = LATIN[char]
  if (!entry) throw new Error(`no skeleton for ${char}`)
  const [width, build] = entry
  return { width, strokes: scaleX(width, build(width)) }
}

// ----------------------------------------------------------------------- pen

function resample(points, step) {
  const out = [points[0]]
  let carried = 0
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1]; const [x1, y1] = points[i]
    const length = Math.hypot(x1 - x0, y1 - y0)
    if (!length) continue
    let at = step - carried
    for (; at <= length; at += step) out.push([x0 + (x1 - x0) * at / length, y0 + (y1 - y0) * at / length])
    carried = length - (at - step)
  }
  const last = points.at(-1)
  if (Math.hypot(last[0] - out.at(-1)[0], last[1] - out.at(-1)[1]) > 0.3) out.push(last)
  return out
}

/**
 * One skeleton stroke, in pixels, as a hand writes it: a small turn, a small
 * change of size and place, and a slow wave along the stroke. A stroke that
 * returns to its start stays closed.
 */
export function penStroke(skeleton, rng, amount = 1, { bow: bowAmount = style.bow, turn = style.turn, wave: waveAmount = 1 } = {}) {
  const closed = skeleton.length > 3 && Math.hypot(skeleton[0][0] - skeleton.at(-1)[0], skeleton[0][1] - skeleton.at(-1)[1]) < 1e-6
  const points = resample(skeleton, 1.1 + rng.next() * 0.4)
  let length = 0
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length
  const angle = rng.gauss() * rad(turn) * amount
  const scale = 1 + rng.gauss() * 0.035 * amount
  const tx = rng.gauss() * 0.5 * amount; const ty = rng.gauss() * 0.5 * amount
  const wave = Math.min(1.5, Math.max(0.15, length * 0.02)) * amount * waveAmount
  const ax = wave * rng.gauss() * 0.7; const ay = wave * rng.gauss() * 0.7
  const fx = 0.5 + rng.next(); const fy = 0.5 + rng.next(); const px = rng.next(); const py = rng.next()
  const cos = Math.cos(angle) * scale; const sin = Math.sin(angle) * scale
  // A straight stroke curves to one side: a horizontal one sags in the middle.
  const chordX = points.at(-1)[0] - points[0][0]; const chordY = points.at(-1)[1] - points[0][1]
  const chord = Math.hypot(chordX, chordY)
  const bow = bowAmount && length > 10 && chord / length > 0.93 ? bowAmount * length * (0.6 + 0.8 * rng.next()) : 0
  const out = points.map(([x, y], i) => {
    const t = points.length > 1 ? i / (points.length - 1) : 0
    const dx = x - cx; const dy = y - cy
    const curve = bow ? bow * Math.sin(Math.PI * t) / chord : 0
    return [cx + dx * cos - dy * sin + tx + ax * Math.sin(2 * Math.PI * (fx * t + px)) - chordY * curve, cy + dx * sin + dy * cos + ty + ay * Math.sin(2 * Math.PI * (fy * t + py)) + chordX * curve]
  })
  if (closed) {
    const gx = out[0][0] - out.at(-1)[0]; const gy = out[0][1] - out.at(-1)[1]
    out.forEach((p, i) => {
      const t = i / (out.length - 1)
      const k = t < 0.75 ? 0 : ((t - 0.75) / 0.25) ** 2 * (3 - 2 * (t - 0.75) / 0.25)
      p[0] += gx * k; p[1] += gy * k
    })
    out[out.length - 1] = [...out[0]]
  }
  return out
}

/** The smallest distance between the points of two groups of strokes. */
export function clearance(groupA, groupB) {
  let nearest = Infinity
  for (const a of groupA) for (const b of groupB) for (const p of a) for (const r of b) {
    const d = (p[0] - r[0]) ** 2 + (p[1] - r[1]) ** 2
    if (d < nearest) nearest = d
  }
  return Math.sqrt(nearest)
}

const round2 = (value) => Math.round(value * 100) / 100

/** A captured stroke in the app's format, from absolute canvas points. */
export function rawStroke(points, rng, strokeWidth) {
  const [x, y] = points[0]
  const relative = points.map(([px, py]) => [round2(px - x), round2(py - y)])
  relative[0] = [0, 0]
  const xs = relative.map((p) => p[0]); const ys = relative.map((p) => p[1])
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rng.next() * 16).toString(16)).join('')
  const peak = 0.55 + rng.next() * 0.25
  return {
    id: `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`,
    x: round2(x), y: round2(y),
    width: round2(Math.max(...xs) - Math.min(...xs)), height: round2(Math.max(...ys) - Math.min(...ys)),
    points: relative,
    pressures: relative.map((_, i) => round2(0.25 + (peak - 0.25) * Math.sin(Math.PI * Math.min(1, (i + 1) / Math.min(8, relative.length))  / 2) * (i > relative.length - 5 ? 0.8 : 1))),
    strokeWidth, version: relative.length + 1,
    lastCommittedPoint: relative.at(-1),
  }
}

/** The writer's constant habits: letters lean right, horizontal strokes rise to the right. */


/** Moves the initial toward the vowel and the final up, until the jamo are `style.gap` pixels apart. */
function bounds(strokes) {
  const points = strokes.flat()
  return { x0: Math.min(...points.map((p) => p[0])), x1: Math.max(...points.map((p) => p[0])), y0: Math.min(...points.map((p) => p[1])), y1: Math.max(...points.map((p) => p[1])) }
}

const shift = (strokes, dx, dy) => strokes.forEach((stroke) => stroke.forEach((point) => { point[0] += dx; point[1] += dy }))

function tighten(placed, kind) {
  const dense = (strokes) => strokes.map((stroke) => resample(stroke, 2))
  const open = !placed.final.length
  const vertical = kind === 'vertical'
  if (vertical) {
    // Beside a vertical vowel the initial stands at the middle height of the vowel.
    const initial = bounds(placed.initial); const medial = bounds(placed.medial)
    shift(placed.initial, 0, (medial.y0 + medial.y1) / 2 - (initial.y0 + initial.y1) / 2)
  }
  const target = vertical ? style.gapSide : !open ? style.gap : kind === 'mixed' ? style.gapMixed : style.gapOpen
  const slack = clearance(dense(placed.initial), dense(placed.medial)) - target
  shift(placed.initial, vertical ? slack : 0, vertical ? 0 : slack)
  if (open) return
  shift(placed.final, 0, style.gapFinal - clearance(dense(placed.final), dense([...placed.initial, ...placed.medial])))
}

/** The strokes of one syllable cell in cell pixels, grouped by role. Tries again while two jamo come too close. */
export function writeSyllable(decomposed, rng) {
  const { size, minimum } = style
  const { parts, yScale } = syllableSkeleton(decomposed)
  let best
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const amount = attempt < 20 ? 1 : 0.5
    const s = size * (1 + rng.gauss() * 0.05 * amount)
    const ox = CELL / 2 - s / 2 + rng.gauss() * style.bounce * amount
    const oy = CELL / 2 - s * yScale * 0.5 + rng.gauss() * style.bounce * amount
    const roles = {}
    const pen = (stroke) => penStroke(stroke, rng, amount, { bow: style.hangulBow, turn: style.hangulTurn, wave: style.hangulWave })
    const place = (role) => {
      const jx = rng.gauss() * 0.016 * amount; const jy = rng.gauss() * 0.016 * amount
      return parts[role].map((stroke) => stroke.map(([x, y]) => {
        const ex = x + jx + style.slant * (0.5 - y) * yScale
        const ey = y + jy - style.rise * (x - 0.5) / yScale
        return [ox + ex * s, oy + ey * s * yScale]
      }))
    }
    if (style.gap) {
      const placed = { initial: place('initial'), medial: place('medial'), final: place('final') }
      tighten(placed, decomposed.kind)
      // Every syllable stands on one line: its ink is centred on the middle of the cell.
      const all = [...placed.initial, ...placed.medial, ...placed.final]
      const ink = bounds(all)
      shift(all, 0, CELL / 2 - (ink.y0 + ink.y1) / 2 + rng.gauss() * style.lineJitter * amount)
      for (const role of ['initial', 'medial', 'final']) roles[role] = placed[role].map(pen)
    } else {
      for (const role of ['initial', 'medial', 'final']) roles[role] = place(role).map(pen)
    }
    const gaps = [clearance(roles.initial, roles.medial)]
    if (roles.final.length) gaps.push(clearance(roles.medial, roles.final), clearance(roles.initial, roles.final))
    const gap = Math.min(...gaps)
    if (!best || gap > best.gap) best = { roles, gap }
    if (gap >= minimum) break
  }
  return best
}

/** The strokes of a letter, digit or symbol cell in cell pixels. */
export function writeLatin(char, rng) {
  const { capHeight } = style
  const top = 52
  const { width, strokes } = latinSkeleton(char)
  const h = capHeight * (1 + rng.gauss() * 0.03)
  const ox = CELL / 2 - width * h / 2 + rng.gauss() * 2
  const oy = top + rng.gauss() * 1.5
  return strokes.map((stroke) => penStroke(stroke.map(([x, y]) => [ox + (x + style.latinSlant * (0.5 - y)) * h, oy + y * h]), rng))
}
