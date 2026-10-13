import type { Box, Point } from '@/font/geometry/path-ops'
import type { HangulRole } from '@/font/hangul'

type Quad = [number, number, number, number]

/** What `tools/sample/home-film.mjs` writes from the example handwriting. */
export interface HomeFilmSource {
  cellSize: number
  cells: Array<{
    char: string
    /** `forms` holds, for each context form of the jamo, whether the written cells hold it. */
    jamo: Array<{ role: HangulRole; char: string; forms: boolean[] }>
    /** Strokes in writing order, in the pixels of their cell. `raw` is the path before hand-shake correction. */
    strokes: Array<{ role: HangulRole; d: string; x: number; y: number; points: Point[]; raw?: Point[]; diameter: number }>
  }>
  /** Syllables the composer makes of the written cells alone, in font units. */
  composed: Array<{ char: string; roles: Array<{ role: HangulRole; d: string; box: Quad; zone?: Quad; from: { cell: number; role: HangulRole } }> }>
  /** How many syllables the written cells compose, and some of them. */
  composable: number
  stream: HomeFilmSource['composed']
  /** Sentences in the font of the whole example handwriting. `pens` holds where the caret stands after each character. */
  lines: Array<{ text: string; width: number; pens: number[]; glyphs: Array<{ char: string; index: number; x: number; d: string }> }>
}

/** The scenes of the home film, in order, with the line shown beside each. */
export const HOME_SCENES = [
  { name: '문장 쓰기', note: '칸마다 한 글자씩, 평소 글씨로 문장을 써요.' },
  { name: '간격 학습', note: '자모의 상자, 자모 사이의 간격, 글자의 높이를 재서 배워요.' },
  { name: '획 다듬기', note: '펜이 지나간 점의 떨림을 보정하고, 그 선에 펜 굵기의 윤곽을 입혀요.' },
  { name: '자모 수집', note: '쓴 획을 초성·중성·종성으로 나누어 수집해요.' },
  { name: '문맥형', note: '쓰지 않은 문맥형은 가장 가까운 문맥형에서 빌려요.' },
  { name: '글자 조합', note: '수집한 자모로 쓰지 않은 글자를 조합해요. 몇 글자만 써도 많은 글자가 나와요.' },
  { name: '폰트 완성', note: '문장 8개를 다 쓰면 한글 11,172자가 폰트가 돼요.' },
] as const

/** Start of each scene in seconds. */
export const HOME_CUES = [0, 5.4, 10.4, 15.4, 19.4, 22.8, 30.4]
export const HOME_LENGTH = 37
/** A still moment of each scene, for reduced motion. */
export const HOME_STILLS = [5.3, 9.6, 13.2, 19.3, 22, 30.3, 35.6]

const INK = '#101114'
const INK_2 = '#4a4c52'
const INK_3 = '#666970'
const LIME = '#C6F432'
const RULE = '#D9DAD5'
const FONT = '"Wanted Sans Variable", "Wanted Sans", sans-serif'
/** Share of a slot a 1000-unit em takes. */
const EM_FIT = 0.84
const SYLLABLES = 11172

const WRITE_START = 0.35
const WRITE_LENGTH = 4.6
/** How many times faster the pen moves between strokes than on them. */
const AIR_SPEED = 3.2
/** Seconds the line between two strokes takes to fade. */
const AIR_FADE = 0.5
const COLLECT_START = 1.1
const COLLECT_STAGGER = 0.07
const COMPOSE_START = 1
const COMPOSE_STAGGER = 0.26
const TRAVEL = 0.42
const DRAW = 0.5
const TYPE_START = 2.1
/** When the three composed syllables make room for the others, in seconds of the composing scene. */
const GATHER = 4.3
/** When the other syllables start to be composed, and the seconds between two of them. They go on into the last scene. */
const STREAM_START = GATHER + 0.3
const STREAM_STEP = 0.068
const streamStart = (index: number) => STREAM_START + index * STREAM_STEP
/** When the field gives way to the sentence, in seconds of the last scene. */
const FIELD_END = 1.3
const TYPE_STEP = 0.105
const EXIT = 0.4
/** How far the background follows the camera. */
const DEPTH = 0.35
const GHOST_INK = 0.07
/** How many cells a background line of handwriting keeps behind its pen. */
const GHOST_TRAIL = 5

interface Stroke { cell: number; order: number; path: Path2D; x: number; y: number; points: Point[]; raw: Point[]; lengths: number[]; diameter: number; start: number; end: number }
/** The pen's way from the end of one stroke to the start of the next, in the pixels of the row of cells. */
interface Air { from: Point; to: Point; start: number; end: number }
interface Jamo { cell: number; role: HangulRole; strokes: Stroke[]; box: Box; length: number; forms: boolean[] }
/** A written syllable: the box of its ink and the space between its first two jamo, in cell pixels. */
interface Measure { cell: number; box: Box; parts: Box[]; gaps: Array<{ box: Box; beside: boolean }> }
/** The strokes of one written cell, and the length of their pen path. */
interface Written { strokes: Stroke[]; length: number }
/** A jamo of a composed syllable, with the pen path of the jamo it was written as, moved onto it. */
interface ComposedRole { role: HangulRole; path: Path2D; box: Box; zone?: Box; source: number; lines: Array<{ points: Point[]; lengths: number[] }>; length: number; width: number }

export interface HomeFilmData {
  cellSize: number
  cells: Array<{ char: string; collects: boolean; done: number }>
  strokes: Stroke[]
  airs: Air[]
  jamo: Jamo[]
  measures: Measure[]
  written: Written[]
  /** Three written syllables of different layouts, as indices of `measures`. */
  specimens: number[]
  /** The height and the space most syllables have, in cell pixels. */
  learned: { height: number; gap: number }
  /** The top and bottom most syllables share, in cell pixels. */
  band: [number, number]
  /** Largest side of a jamo's ink, in cell pixels. */
  extent: number
  composed: ComposedRole[][]
  composable: number
  stream: ComposedRole[][]
  lines: Array<{ width: number; pens: number[]; glyphs: Array<{ index: number; x: number; path: Path2D }> }>
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const ease = (value: number) => 1 - (1 - clamp(value)) ** 4
const easeInOut = (value: number) => { const t = clamp(value); return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2 }
const span = (value: number, from: number, to: number) => clamp((value - from) / (to - from))
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const toBox = ([x1, y1, x2, y2]: Quad): Box => ({ x1, y1, x2, y2 })
/** A fixed number between 0 and 1 for each seed. */
const scatter = (seed: number) => { const value = Math.sin(seed * 127.1) * 43758.5453; return value - Math.floor(value) }

function arcLengths(points: readonly Point[]) {
  const lengths = [0]
  for (let index = 1; index < points.length; index += 1) lengths.push(lengths[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]))
  return lengths
}

/** Reads the film's source into paths, and sets the time of every stroke of the writing scene. */
export function buildHomeFilm(source: HomeFilmSource): HomeFilmData {
  const size = source.cellSize
  const strokes: Stroke[] = []
  const jamo: Jamo[] = []
  const measures: Measure[] = []
  source.cells.forEach((cell, cellIndex) => {
    const first = jamo.length
    for (const { role, forms } of cell.jamo) jamo.push({ cell: cellIndex, role, forms, strokes: [], box: { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }, length: 0 })
    cell.strokes.forEach((item, order) => {
      const stroke: Stroke = { cell: cellIndex, order, path: new Path2D(item.d), x: item.x, y: item.y, points: item.points, raw: item.raw ?? item.points, lengths: arcLengths(item.points), diameter: item.diameter, start: 0, end: 0 }
      strokes.push(stroke)
      const owner = jamo.slice(first).find((candidate) => candidate.role === item.role)
      if (!owner) return
      owner.strokes.push(stroke)
      owner.length += stroke.lengths.at(-1)!
      const pad = item.diameter / 2
      for (const [x, y] of item.points) owner.box = { x1: Math.min(owner.box.x1, x - pad), y1: Math.min(owner.box.y1, y - pad), x2: Math.max(owner.box.x2, x + pad), y2: Math.max(owner.box.y2, y + pad) }
    })
    const own = jamo.slice(first)
    if (!own.length) return
    const box = { x1: Math.min(...own.map((item) => item.box.x1)), y1: Math.min(...own.map((item) => item.box.y1)), x2: Math.max(...own.map((item) => item.box.x2)), y2: Math.max(...own.map((item) => item.box.y2)) }
    const join = (a: Box, b: Box): Box => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) })
    // The space between the first two jamo, then between that pair and the final.
    const gaps: Measure['gaps'] = []
    own.slice(1).forEach((item, index) => {
      const upper = own.slice(0, index + 1).map((part) => part.box).reduce(join)
      const lower = item.box
      const beside = index === 0 && lower.x1 - upper.x2 >= lower.y1 - upper.y2
      const gap = beside
        ? { x1: upper.x2, x2: lower.x1, y1: Math.max(upper.y1, lower.y1), y2: Math.min(upper.y2, lower.y2) }
        : { y1: upper.y2, y2: lower.y1, x1: Math.max(upper.x1, lower.x1), x2: Math.min(upper.x2, lower.x2) }
      if (gap.x2 > gap.x1 && gap.y2 > gap.y1) gaps.push({ box: gap, beside })
    })
    measures.push({ cell: cellIndex, box, parts: own.map((item) => item.box), gaps })
  })

  // The pen keeps one speed on the strokes and a faster one between them.
  const airs: Air[] = []
  let clock = 0
  strokes.forEach((stroke, index) => {
    stroke.start = clock
    clock += stroke.lengths.at(-1)!
    stroke.end = clock
    const next = strokes[index + 1]
    if (!next) return
    const from: Point = [stroke.cell * size + stroke.points.at(-1)![0], stroke.points.at(-1)![1]]
    const to: Point = [next.cell * size + next.points[0][0], next.points[0][1]]
    const length = Math.max(size * 0.08, Math.hypot(to[0] - from[0], to[1] - from[1]) / AIR_SPEED)
    airs.push({ from, to, start: clock, end: clock + length })
    clock += length
  })
  const pace = WRITE_LENGTH / clock
  for (const item of [...strokes, ...airs]) { item.start = WRITE_START + item.start * pace; item.end = WRITE_START + item.end * pace }

  // One syllable with its vowel under the initial, one with it beside, one with a final; then whatever else was written.
  const kinds = [measures.findIndex((item) => item.parts.length === 2 && !item.gaps[0]?.beside), measures.findIndex((item) => item.parts.length === 2 && item.gaps[0]?.beside), measures.findIndex((item) => item.parts.length === 3)]
  const specimens = [...new Set([...kinds.filter((index) => index >= 0), ...measures.keys()])].slice(0, 3).sort((a, b) => a - b)

  const place = (syllable: HomeFilmSource['composed'][number]) => syllable.roles.map((role): ComposedRole => {
    const index = jamo.findIndex((candidate) => candidate.cell === role.from.cell && candidate.role === role.from.role)
    const from = jamo[index]
    const [x1, y1, x2, y2] = role.box
    const kx = (x2 - x1) / (from.box.x2 - from.box.x1)
    const ky = (y2 - y1) / (from.box.y2 - from.box.y1)
    const lines = from.strokes.map((stroke) => {
      const points = stroke.points.map(([x, y]): Point => [x1 + (x - from.box.x1) * kx, y2 - (y - from.box.y1) * ky])
      return { points, lengths: arcLengths(points) }
    })
    return { role: role.role, path: new Path2D(role.d), box: toBox(role.box), zone: role.zone && toBox(role.zone), source: index, lines, length: lines.reduce((sum, line) => sum + line.lengths.at(-1)!, 0), width: from.strokes[0].diameter * Math.max(kx, ky) * 2.4 }
  })
  const composed = source.composed.map(place)

  return {
    cellSize: size,
    cells: source.cells.map((cell, cellIndex) => ({ char: cell.char, collects: cell.jamo.length > 0, done: Math.max(0, ...strokes.filter((stroke) => stroke.cell === cellIndex).map((stroke) => stroke.end)) })),
    strokes, airs, jamo, measures, composed,
    written: measures.map((item) => { const own = strokes.filter((stroke) => stroke.cell === item.cell); return { strokes: own, length: own.reduce((sum, stroke) => sum + stroke.lengths.at(-1)!, 0) } }),
    specimens,
    composable: source.composable,
    stream: source.stream.map(place),
    learned: { height: median(measures.map((item) => item.box.y2 - item.box.y1)), gap: median(measures.flatMap((item) => item.gaps.slice(0, 1).map((gap) => gap.beside ? gap.box.x2 - gap.box.x1 : gap.box.y2 - gap.box.y1))) },
    band: [median(measures.map((item) => item.box.y1)), median(measures.map((item) => item.box.y2))],
    extent: Math.max(...jamo.map((item) => Math.max(item.box.x2 - item.box.x1, item.box.y2 - item.box.y1))),
    lines: source.lines.map((line) => ({ width: line.width, pens: line.pens, glyphs: line.glyphs.map((glyph) => ({ index: glyph.index, x: glyph.x, path: new Path2D(glyph.d) })) })),
  }
}

/** The scene the film is on at `time`. */
export function homeScene(time: number) {
  let scene = 0
  for (let index = 1; index < HOME_CUES.length; index += 1) if (time >= HOME_CUES[index]) scene = index
  return scene
}

export interface HomeFilmFrame {
  /** Seconds since the loop started. */
  time: number
  /** Seconds the film has played in all; the background runs on it. */
  played: number
  /** Which closing sentence this loop ends on. */
  line: number
  /** The film keeps above this height; below it the page's own panel stands. */
  floor: number
  /** Holds the camera in place, for reduced motion. */
  still: boolean
}

/** Where the camera looks, in stage pixels, and how much it magnifies. */
interface Shot { time: number; x: number; y: number; zoom: number }

/** Draws one frame of the home film on a canvas of `width` by `height` CSS pixels. */
export function drawHomeFilm(context: CanvasRenderingContext2D, width: number, height: number, dpr: number, data: HomeFilmData, frame: HomeFilmFrame) {
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const time = frame.time
  const [, MEASURE, REFINE, COLLECT, FORMS, COMPOSE, TYPE] = HOME_CUES
  const measure = time - MEASURE
  const refine = time - REFINE
  const collect = time - COLLECT
  const forms = time - FORMS
  const compose = time - COMPOSE
  const type = time - TYPE
  const enter = ease(span(time, 0, 0.4))
  const lift = ease(span(measure, 0, 0.6))
  const rise = ease(span(collect, 0, 0.6))
  const ground = span(time, 0, 0.6) * (1 - span(type, 0, 0.6))
  const leave = ease(span(compose, 0, 0.6))
  const exit = 1 - span(time, HOME_LENGTH - EXIT, HOME_LENGTH)

  const top = 28
  const room = Math.max(160, Math.min(frame.floor, height) - top)
  const pad = Math.max(24, Math.min(64, width * 0.04))
  const count = data.cells.length
  const cell = Math.max(48, Math.min((width - pad * 2) / count, room * 0.36, 132))
  const k = cell / data.cellSize
  const rowLeft = (width - cell * count) / 2
  const rowMiddle = top + (room - cell) / 2

  const tile = Math.min(cell * 0.56, (width - pad * 2) / (data.jamo.length * 1.14 + count * 0.3))
  const rowGap = room * 0.12
  const rowUp = top + Math.max(room * 0.05, (room - cell - rowGap - tile) / 2)
  const rowHigh = top + room * 0.05
  const rowTop = mix(mix(rowMiddle, rowHigh, lift), rowUp, rise)
  const boxTop = rowHigh + cell + Math.max(20, room * 0.06)
  const boxSide = Math.max(72, Math.min(220, top + room - boxTop - 58, (width - pad * 2) / 4))
  const boxGap = boxSide * 0.3
  const boxesLeft = (width - boxSide * 3 - boxGap * 2) / 2
  const kb = boxSide * EM_FIT / data.cellSize
  const tileGap = tile * 0.14
  const groupGap = tile * 0.3
  const tileLefts: number[] = []
  let cursor = 0
  data.jamo.forEach((item, index) => {
    if (index && item.cell !== data.jamo[index - 1].cell) cursor += groupGap
    tileLefts.push(cursor)
    cursor += tile + tileGap
  })
  const tilesWidth = cursor - tileGap
  const tilesLeft = (width - tilesWidth) / 2
  const tilesLow = rowUp + cell + rowGap
  const tilesHigh = top + room * 0.05
  const tilesTop = mix(tilesLow, tilesHigh, leave)
  const tileScale = tile * 0.72 / data.extent
  const tileCentre = (index: number): Point => [tilesLeft + tileLefts[index] + tile / 2, tilesTop + tile / 2]

  const slot = Math.min(room * 0.5, 220, (width - pad * 2) / (data.composed.length + 1))
  const slotGap = slot * 0.3
  const slotsLeft = (width - (slot * data.composed.length + slotGap * (data.composed.length - 1))) / 2
  const slotsTop = tilesHigh + tile + Math.max(20, (room * 0.9 - tile - slot) / 2)

  // The camera: it comes a little closer while the pen writes, with the whole row in view, then goes back.
  const centreX = width / 2
  const centreY = top + room / 2
  const close = Math.max(1, Math.min(1.06, (width - 32) / (cell * count)))
  const rowY = rowMiddle + cell / 2
  const shots: Shot[] = [
    { time: MEASURE - 0.2, x: centreX, y: rowY, zoom: close },
    { time: MEASURE + 0.8, x: centreX, y: centreY, zoom: 1 },
    { time: HOME_LENGTH, x: centreX, y: centreY, zoom: 1 },
  ]
  let camera = { x: centreX, y: centreY, zoom: 1 }
  if (!frame.still) {
    if (time < shots[0].time) {
      const arrived = easeInOut(span(time, 0, 1))
      camera = { x: centreX, y: mix(centreY, rowY, arrived), zoom: mix(1, close, arrived) }
    } else {
      const next = Math.max(1, shots.findIndex((shot) => shot.time > time))
      const from = shots[next - 1]
      const to = shots[next]
      const amount = easeInOut(span(time, from.time, to.time))
      camera = { x: mix(from.x, to.x, amount), y: mix(from.y, to.y, amount), zoom: mix(from.zoom, to.zoom, amount) }
    }
    // The camera is held by hand: it is never quite still.
    camera.x += Math.sin(frame.played * 0.7) * 5 / camera.zoom
    camera.y += Math.cos(frame.played * 0.53) * 3 / camera.zoom
    camera.zoom *= 1 + Math.sin(frame.played * 0.41) * 0.012
  }
  const zoom = camera.zoom
  /** Draws in stage pixels scaled by (kx, ky) and moved by (tx, ty), as the camera sees them. */
  const view = (kx = 1, ky = 1, tx = 0, ty = 0) => context.setTransform(dpr * zoom * kx, 0, 0, dpr * zoom * ky, dpr * (zoom * (tx - camera.x) + centreX), dpr * (zoom * (ty - camera.y) + centreY))
  const hair = 1 / zoom

  /** A polyline up to `length` along it. */
  const trace = (points: readonly Point[], lengths: readonly number[], length: number) => {
    context.moveTo(points[0][0], points[0][1])
    for (let index = 1; index < points.length; index += 1) {
      if (lengths[index] <= length) { context.lineTo(points[index][0], points[index][1]); continue }
      const part = (length - lengths[index - 1]) / (lengths[index] - lengths[index - 1])
      context.lineTo(mix(points[index - 1][0], points[index][0], part), mix(points[index - 1][1], points[index][1], part))
      break
    }
  }

  /** A written stroke in the pixels of its cell, drawn as far as the pen has come. */
  const drawStroke = (stroke: Stroke, progress: number) => {
    if (progress <= 0) return
    context.save()
    context.translate(stroke.x, stroke.y)
    if (progress >= 1) {
      context.fill(stroke.path)
    } else {
      context.clip(stroke.path)
      context.translate(-stroke.x, -stroke.y)
      context.lineWidth = stroke.diameter * 2.4
      context.beginPath()
      trace(stroke.points, stroke.lengths, stroke.lengths.at(-1)! * progress)
      context.stroke()
    }
    context.restore()
  }

  /** The strokes of a jamo, one after the other, as far as `drawn` of its whole length. */
  const drawJamo = (item: { strokes: Stroke[] }, drawn: number) => {
    let before = 0
    for (const stroke of item.strokes) {
      const length = stroke.lengths.at(-1)!
      drawStroke(stroke, (drawn - before) / length)
      before += length
    }
  }

  /** A thin line that leaves `from`, runs to `to`, and is gone once it arrives. `bow` lifts its middle. */
  const drawFlight = (from: Point, to: Point, progress: number, bow = 0) => {
    if (progress <= 0 || progress >= 1) return
    const head = easeInOut(span(progress, 0, 0.72))
    const tail = easeInOut(span(progress, 0.28, 1))
    const middle = (from[1] + to[1]) / 2 - bow
    const at = (t: number): Point => {
      const u = 1 - t
      return [u ** 3 * from[0] + 3 * u * u * t * from[0] + 3 * u * t * t * to[0] + t ** 3 * to[0], u ** 3 * from[1] + 3 * u * u * t * middle + 3 * u * t * t * middle + t ** 3 * to[1]]
    }
    view()
    context.strokeStyle = INK
    context.fillStyle = INK
    context.lineWidth = 1.5 * hair
    context.beginPath()
    for (let step = 0; step <= 24; step += 1) {
      const [x, y] = at(mix(tail, head, step / 24))
      if (step) context.lineTo(x, y)
      else context.moveTo(x, y)
    }
    context.stroke()
    const [x, y] = at(head)
    context.beginPath()
    context.arc(x, y, 2.5 * hair, 0, Math.PI * 2)
    context.fill()
  }

  // The background: the grid of the writing page, where a faint pen writes along every row without a stop. It moves less than the film, and clears for the finished font.
  const depth = 1 + (zoom - 1) * DEPTH
  const farX = mix(centreX, camera.x, DEPTH)
  const farY = mix(centreY, camera.y, DEPTH)
  context.setTransform(dpr * depth, 0, 0, dpr * depth, dpr * (centreX - farX * depth), dpr * (centreY - farY * depth))
  const gridLeft = rowLeft - Math.ceil(rowLeft / cell + 1) * cell
  const gridTop = rowMiddle - Math.ceil(rowMiddle / cell + 1) * cell
  const columns = Math.ceil((width - gridLeft) / cell) + 1
  const rows = Math.ceil((height - gridTop) / cell) + 1
  context.globalAlpha = 0.5 * ground
  context.fillStyle = RULE
  for (let column = 0; column <= columns; column += 1) context.fillRect(Math.round(gridLeft + column * cell), gridTop, 1, rows * cell)
  for (let row = 0; row <= rows; row += 1) context.fillRect(gridLeft, Math.round(gridTop + row * cell), columns * cell, 1)
  context.fillStyle = INK
  context.strokeStyle = INK
  for (let row = 0; row < rows; row += 1) {
    const reached = frame.played * (0.5 + scatter(row + 3) * 0.35) + scatter(row * 9.1) * 50
    const head = Math.floor(reached)
    for (let back = 0; back <= GHOST_TRAIL; back += 1) {
      const item = data.written[Math.floor(scatter(row * 31 + (head - back) * 1.37) * data.written.length)]
      const drawn = back ? item.length : Math.min(1, (reached - head) * 1.2) * item.length
      context.save()
      context.translate(gridLeft + ((head - back) % columns + columns) % columns * cell, gridTop + row * cell)
      context.scale(k, k)
      context.globalAlpha = ground * GHOST_INK * (1 - span(back + reached - head, 1.2, GHOST_TRAIL))
      drawJamo(item, drawn)
      if (!back) {
        let before = 0
        const live = item.strokes.find((stroke) => (before += stroke.lengths.at(-1)!) >= drawn) ?? item.strokes.at(-1)!
        const length = drawn - (before - live.lengths.at(-1)!)
        const index = Math.max(1, live.lengths.findIndex((value) => value >= length))
        const part = (length - live.lengths[index - 1]) / Math.max(1e-6, live.lengths[index] - live.lengths[index - 1])
        context.globalAlpha = 0.28 * ground
        context.beginPath()
        context.arc(mix(live.points[index - 1][0], live.points[index][0], part), mix(live.points[index - 1][1], live.points[index][1], part), live.diameter * 0.7, 0, Math.PI * 2)
        context.fill()
      }
      context.restore()
    }
  }

  const collectStart = (index: number) => COLLECT_START + index * COLLECT_STAGGER
  const roleStarts: number[][] = []
  let order = 0
  for (const syllable of data.composed) roleStarts.push(syllable.map(() => COMPOSE_START + (order++) * COMPOSE_STAGGER))

  // The written row: the cells of the writing page, and the strokes as the pen makes them.
  const rowAlpha = enter * (1 - leave)
  if (rowAlpha > 0) {
    view()
    data.cells.forEach((item, index) => {
      const x = Math.round(rowLeft + index * cell)
      const y = Math.round(rowTop)
      const side = Math.round(rowLeft + (index + 1) * cell) - x
      context.globalAlpha = rowAlpha
      context.fillStyle = '#fff'
      context.fillRect(x, y, side, side)
      const wash = item.collects && item.done ? ease(span(time, item.done, item.done + 0.24)) * (1 - span(measure, 0, 0.6)) : 0
      if (wash > 0) {
        context.globalAlpha = rowAlpha * wash * 0.24
        context.fillStyle = LIME
        context.fillRect(x, y, side, side)
      }
      context.globalAlpha = rowAlpha * 0.06
      context.fillStyle = INK
      context.fillRect(x + side / 2 - 0.5, y, 1, side)
      context.fillRect(x, y + side / 2 - 0.5, side, 1)
      context.globalAlpha = rowAlpha
      context.strokeStyle = RULE
      context.lineWidth = 1
      context.strokeRect(x + 0.5, y + 0.5, side, side)
      if (item.collects) {
        context.fillStyle = INK_3
        context.font = `600 12px ${FONT}`
        context.textAlign = 'right'
        context.fillText(item.char, x + side - 8, y + side - 10)
      }
    })
    const writing = data.strokes.find((stroke) => time >= stroke.start && time < stroke.end) ?? data.strokes.find((stroke) => stroke.start > time)
    if (writing && time >= WRITE_START) {
      context.globalAlpha = rowAlpha
      context.strokeStyle = INK
      context.strokeRect(Math.round(rowLeft + writing.cell * cell) + 0.5, Math.round(rowTop) + 0.5, Math.round(cell), Math.round(cell))
    }

    // While the handwriting is measured and conditioned the row steps back: the work shows on the specimens under it.
    const studied = span(measure, 0, 0.5) - span(refine, 3.6, 4.1)
    context.fillStyle = INK
    context.strokeStyle = INK
    data.jamo.forEach((item, index) => {
      const gone = ease(span(collect, collectStart(index), collectStart(index) + TRAVEL))
      context.globalAlpha = rowAlpha * mix(1, 0.35, studied) * mix(1, 0.2, gone)
      view(k, k, rowLeft + item.cell * cell, rowTop)
      for (const stroke of item.strokes) drawStroke(stroke, span(time, stroke.start, stroke.end))
    })

    // Between two strokes the pen does not lift: the line it leaves there fades.
    view(k, k, rowLeft, rowTop)
    context.lineWidth = 1.5 * hair / k
    let tip: Point | undefined
    for (const air of data.airs) {
      const grown = span(time, air.start, air.end)
      const fade = 1 - span(time, air.end, air.end + AIR_FADE)
      if (grown <= 0 || fade <= 0) continue
      const lift = Math.min(Math.hypot(air.to[0] - air.from[0], air.to[1] - air.from[1]) * 0.25, data.cellSize * 0.3)
      const at = (t: number): Point => [(1 - t) ** 2 * air.from[0] + 2 * (1 - t) * t * (air.from[0] + air.to[0]) / 2 + t * t * air.to[0], (1 - t) ** 2 * air.from[1] + 2 * (1 - t) * t * ((air.from[1] + air.to[1]) / 2 - lift) + t * t * air.to[1]]
      context.globalAlpha = rowAlpha * fade * 0.55
      context.beginPath()
      for (let step = 0; step <= 16; step += 1) {
        const [x, y] = at(grown * step / 16)
        if (step) context.lineTo(x, y)
        else context.moveTo(x, y)
      }
      context.stroke()
      if (grown < 1) tip = at(grown)
    }
    const live = data.strokes.find((stroke) => time >= stroke.start && time < stroke.end)
    if (live) {
      const length = live.lengths.at(-1)! * span(time, live.start, live.end)
      const index = Math.max(1, live.lengths.findIndex((value) => value >= length))
      const part = (length - live.lengths[index - 1]) / Math.max(1e-6, live.lengths[index] - live.lengths[index - 1])
      tip = [live.cell * data.cellSize + mix(live.points[index - 1][0], live.points[index][0], part), mix(live.points[index - 1][1], live.points[index][1], part)]
    }
    if (tip) {
      context.globalAlpha = rowAlpha
      context.beginPath()
      context.arc(tip[0], tip[1], data.strokes[0].diameter * 0.75, 0, Math.PI * 2)
      context.fill()
    }

    // Measuring and conditioning, shown large on three written syllables of different layouts.
    const shown = ease(span(measure, 0.4, 0.9)) * (1 - span(refine, 4.3, 4.8))
    if (shown > 0) {
      const marked = 1 - span(measure, 4.5, 5)
      /** The measures of a syllable in the pixels of its cell: a box around each jamo, the space between them in lime, and its height at its left. */
      const drawMeasure = (item: Measure, boxed: number, spaced: number, grown: number, thin: number) => {
        context.strokeStyle = INK
        context.lineWidth = thin
        if (boxed > 0) {
          for (const part of item.parts) {
            const around = (part.x2 - part.x1 + part.y2 - part.y1) * 2
            context.setLineDash([around * boxed, around])
            context.strokeRect(part.x1, part.y1, part.x2 - part.x1, part.y2 - part.y1)
          }
          context.setLineDash([])
        }
        context.fillStyle = LIME
        for (const gap of item.gaps) context.fillRect(gap.box.x1, gap.box.y1, (gap.box.x2 - gap.box.x1) * (gap.beside ? spaced : 1), (gap.box.y2 - gap.box.y1) * (gap.beside ? 1 : spaced))
        if (grown <= 0) return
        const x = item.box.x1 - 6
        const y = mix(item.box.y1, item.box.y2, grown)
        context.beginPath()
        context.moveTo(x, item.box.y1); context.lineTo(x, y)
        context.moveTo(x - 3, item.box.y1); context.lineTo(x + 3, item.box.y1)
        context.moveTo(x - 3, y); context.lineTo(x + 3, y)
        context.stroke()
      }
      const share = (value: number) => `${Math.round(value / data.cellSize * 100)}%`
      const gapOf = (item: Measure) => item.gaps[0] && (item.gaps[0].beside ? item.gaps[0].box.x2 - item.gaps[0].box.x1 : item.gaps[0].box.y2 - item.gaps[0].box.y1)

      // Every syllable of the row is measured the same way, then the height most of them share runs along the row.
      if (marked > 0) {
        data.measures.forEach((item, index) => {
          view(k, k, rowLeft + item.cell * cell, rowTop)
          context.globalAlpha = rowAlpha * marked
          drawMeasure(item, 0, ease(span(measure, 2.6 + index * 0.05, 3 + index * 0.05)), ease(span(measure, 2.8 + index * 0.05, 3.2 + index * 0.05)), hair / k)
        })
        const shared = ease(span(measure, 3.3, 4))
        if (shared > 0) {
          view()
          context.globalAlpha = rowAlpha * marked
          context.strokeStyle = INK
          context.lineWidth = hair
          context.setLineDash([1, 4])
          context.beginPath()
          for (const y of data.band) { context.moveTo(rowLeft, rowTop + y * k); context.lineTo(rowLeft + cell * count * shared, rowTop + y * k) }
          context.stroke()
          context.setLineDash([])
        }
      }

      data.specimens.forEach((at, index) => {
        const item = data.measures[at]
        const written = data.written[at]
        const left = Math.round(boxesLeft + index * (boxSide + boxGap))
        const delay = index * 0.12
        view()
        context.globalAlpha = shown
        context.fillStyle = '#fff'
        context.fillRect(left, Math.round(boxTop), Math.round(boxSide), Math.round(boxSide))
        context.strokeStyle = RULE
        context.lineWidth = 1
        context.strokeRect(left + 0.5, Math.round(boxTop) + 0.5, Math.round(boxSide), Math.round(boxSide))

        const thin = hair / kb
        const originX = left + boxSide * (1 - EM_FIT) / 2
        const originY = boxTop + boxSide * (1 - EM_FIT) / 2
        view(kb, kb, originX, originY)
        context.globalAlpha = shown * mix(1, 0.35, span(measure, 1.5, 1.9)) * mix(1, 0.23, span(refine, 0.2, 0.7))
        context.fillStyle = INK
        context.strokeStyle = INK
        drawJamo(written, span(measure, 0.9 + delay, 1.5 + delay) * written.length)

        if (marked > 0) {
          context.globalAlpha = shown * marked
          drawMeasure(item, ease(span(measure, 1.6, 2.1)), ease(span(measure, 2, 2.5)), ease(span(measure, 2.5, 3)), thin)
          const shared = ease(span(measure, 3.3, 4))
          if (shared > 0) {
            context.strokeStyle = INK
            context.lineWidth = thin
            context.setLineDash([thin, 4 * thin])
            context.beginPath()
            for (const y of data.band) { context.moveTo(0, y); context.lineTo(data.cellSize * shared, y) }
            context.stroke()
            context.setLineDash([])
          }
          view()
          context.font = `700 12px ${FONT}`
          context.fillStyle = INK
          const gap = gapOf(item)
          if (gap) {
            context.globalAlpha = shown * marked * ease(span(measure, 2.2, 2.6))
            context.textAlign = 'left'
            context.fillText(`간격 ${share(gap)}`, left, boxTop + boxSide + 18)
          }
          context.globalAlpha = shown * marked * ease(span(measure, 2.7, 3.1))
          context.textAlign = 'right'
          context.fillText(`높이 ${share(item.box.y2 - item.box.y1)}`, left + boxSide, boxTop + boxSide + 18)
          view(kb, kb, originX, originY)
        }

        // Hand-shake correction and the outline. The points of the pen run along the raw path, which stays as a lime trace.
        // They settle onto the corrected path, the path swells to the width of the pen, then ink fills it the way the pen went.
        if (refine > 0) {
          for (const stroke of written.strokes) {
            const local = refine - stroke.order * 0.06
            const total = stroke.lengths.at(-1)!
            const sampled = total * span(local, 0.4, 1.2)
            const settled = easeInOut(span(local, 1.3, 2))
            const swollen = ease(span(local, 2.1, 2.8))
            const filled = span(local, 2.9, 3.6)
            const path = stroke.raw.map(([x, y], point): Point => [mix(x, stroke.points[point][0], settled), mix(y, stroke.points[point][1], settled)])
            if (swollen < 1 && sampled > 0) {
              context.globalAlpha = shown * (1 - swollen)
              context.strokeStyle = LIME
              context.lineWidth = stroke.diameter * 1.25
              context.beginPath()
              trace(stroke.raw, stroke.lengths, sampled)
              context.stroke()
            }
            if (swollen > 0 && filled < 1) {
              const wide = mix(1.2 * thin, stroke.diameter, swollen)
              context.globalAlpha = shown
              for (const [color, extra] of [[INK, 2.4 * thin], [LIME, 0]] as const) {
                context.strokeStyle = color
                context.lineWidth = wide + extra
                context.beginPath()
                trace(path, stroke.lengths, total)
                context.stroke()
              }
            }
            if (swollen < 1 && sampled > 0) {
              context.globalAlpha = shown * (1 - swollen)
              context.strokeStyle = INK
              context.fillStyle = INK
              context.lineWidth = 1.2 * thin
              context.beginPath()
              trace(path, stroke.lengths, sampled)
              context.stroke()
              const every = Math.max(1, Math.round(path.length / 12))
              context.beginPath()
              path.forEach(([x, y], point) => {
                if (stroke.lengths[point] > sampled || (point % every && point !== path.length - 1)) return
                const size = mix(3.6, 2, span(sampled - stroke.lengths[point], 0, total * 0.2)) * thin
                context.moveTo(x + size, y)
                context.arc(x, y, size, 0, Math.PI * 2)
              })
              context.fill()
            }
            context.globalAlpha = shown
            context.fillStyle = INK
            context.strokeStyle = INK
            drawStroke(stroke, filled)
          }
        }
        context.globalAlpha = shown
        drawFlight([rowLeft + (item.cell + 0.5) * cell, rowHigh + cell / 2], [left + boxSide / 2, boxTop + boxSide / 2], span(measure, 0.4 + delay, 0.4 + delay + TRAVEL + 0.2))
      })

      // The steps of the work in words, the one in work on lime.
      const steps = refine > 0
        ? { names: ['펜이 지나간 점', '손떨림 보정', '펜 굵기의 윤곽', '잉크'], live: refine < 1.3 ? 0 : refine < 2.1 ? 1 : refine < 2.9 ? 2 : 3, alpha: ease(span(refine, 0.2, 0.6)) * (1 - span(refine, 4.3, 4.8)) }
        : { names: ['자모의 상자', '자모 사이의 간격', '글자의 높이', `배운 값 · 높이 ${share(data.learned.height)} · 간격 ${share(data.learned.gap)}`], live: measure < 2 ? 0 : measure < 2.5 ? 1 : measure < 3.3 ? 2 : 3, alpha: ease(span(measure, 1.4, 1.8)) * (1 - span(measure, 4.6, 5)) }
      if (steps.alpha > 0) {
        view()
        context.font = `600 12px ${FONT}`
        context.textAlign = 'left'
        const widths = steps.names.map((name) => context.measureText(name).width)
        const between = 30
        let x = centreX - (widths.reduce((sum, value) => sum + value, 0) + between * (widths.length - 1)) / 2
        const y = Math.round(boxTop + boxSide + 46)
        steps.names.forEach((name, index) => {
          context.globalAlpha = steps.alpha
          if (index === steps.live) {
            context.fillStyle = LIME
            context.fillRect(Math.round(x - 6), y - 15, Math.round(widths[index] + 12), 22)
          }
          context.fillStyle = index === steps.live ? INK : index < steps.live ? INK_2 : INK_3
          context.fillText(name, x, y)
          x += widths[index]
          if (index < widths.length - 1) {
            context.fillStyle = RULE
            context.fillRect(x + 9, y - 5, between - 18, 1)
          }
          x += between
        })
      }
    }

    // The order the strokes of each cell were written in.
    const numbered = span(collect, 0.15, 0.45) - span(collect, 0.95, 1.25)
    if (numbered > 0) {
      view()
      context.font = `700 9px ${FONT}`
      context.textAlign = 'center'
      for (const stroke of data.strokes) {
        const x = rowLeft + stroke.cell * cell + stroke.points[0][0] * k
        const y = rowTop + stroke.points[0][1] * k
        context.globalAlpha = rowAlpha * numbered
        context.fillStyle = INK
        context.beginPath()
        context.arc(x, y, 6.5, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = '#fff'
        context.fillText(String(stroke.order + 1), x, y + 3.2)
      }
    }
  }

  // The collected jamo: one tile for each, outlined for an initial, lime for a medial, dashed for a final.
  const tilesAlpha = ease(span(collect, 0.3, 0.8)) * (1 - span(type, FIELD_END, FIELD_END + 0.5))
  if (tilesAlpha > 0) {
    const used = new Set<number>()
    data.composed.forEach((syllable, s) => syllable.forEach((role, r) => {
      if (compose >= roleStarts[s][r] && compose < roleStarts[s][r] + TRAVEL + DRAW) used.add(role.source)
    }))
    data.stream.forEach((syllable, index) => {
      if (compose >= streamStart(index) && compose < streamStart(index) + 0.6 && type < FIELD_END) for (const role of syllable) used.add(role.source)
    })
    const unit = Math.max(4, Math.floor(tile / 4) - 2)
    const listed = 1 - span(forms, 2.9, 3.4)
    data.jamo.forEach((item, index) => {
      const [cx, cy] = tileCentre(index)
      const left = Math.round(cx - tile / 2) + 0.5
      const upper = Math.round(cy - tile / 2) + 0.5
      const side = Math.round(tile)
      view()
      context.globalAlpha = tilesAlpha
      context.fillStyle = item.role === 'medial' ? LIME : '#fff'
      context.fillRect(left - 0.5, upper - 0.5, side + 1, side + 1)
      context.strokeStyle = INK
      context.lineWidth = used.has(index) ? 2 : 1
      if (item.role !== 'medial' || used.has(index)) {
        context.setLineDash(item.role === 'final' && !used.has(index) ? [4, 3] : [])
        context.strokeRect(left, upper, side, side)
        context.setLineDash([])
      }
      const scale = tileScale
      context.fillStyle = INK
      context.strokeStyle = INK
      view(scale, scale, cx - (item.box.x1 + item.box.x2) / 2 * scale, cy - (item.box.y1 + item.box.y2) / 2 * scale)
      drawJamo(item, span(collect, collectStart(index) + TRAVEL, collectStart(index) + TRAVEL + DRAW) * item.length)

      // One square for each context form of the jamo: ink for a written one, lime for one borrowed from the nearest.
      const shown = ease(span(forms, 0.3 + index * 0.05, 0.7 + index * 0.05)) * listed
      if (shown <= 0) return
      view()
      const perRow = Math.min(4, item.forms.length)
      const formsLeft = cx - (perRow * unit + (perRow - 1) * 2) / 2
      item.forms.forEach((written, form) => {
        const x = Math.round(formsLeft + form % perRow * (unit + 2))
        const y = Math.round(upper + side + 7 + Math.floor(form / perRow) * (unit + 2))
        context.globalAlpha = tilesAlpha * shown
        if (written) {
          context.fillStyle = INK
          context.fillRect(x, y, unit, unit)
          return
        }
        const borrowed = ease(span(forms, 1.5 + index * 0.04, 1.9 + index * 0.04))
        context.strokeStyle = INK
        context.lineWidth = 1
        context.setLineDash([2, 2])
        context.strokeRect(x + 0.5, y + 0.5, unit - 1, unit - 1)
        context.setLineDash([])
        context.globalAlpha = tilesAlpha * shown * borrowed
        context.fillStyle = LIME
        context.fillRect(x, y, unit, unit)
      })
    })
    const keyed = ease(span(forms, 0.9, 1.4)) * listed
    if (keyed > 0) {
      view()
      const y = Math.round(tilesTop + tile + 7 + unit * 2 + 22)
      context.globalAlpha = tilesAlpha * keyed
      context.font = `600 12px ${FONT}`
      context.textAlign = 'left'
      context.fillStyle = INK
      context.fillRect(centreX - 104, y - 9, 9, 9)
      context.fillStyle = LIME
      context.fillRect(centreX + 4, y - 9, 9, 9)
      context.fillStyle = INK_2
      context.fillText('쓴 문맥형', centreX - 90, y)
      context.fillText('빌려 쓰는 문맥형', centreX + 18, y)
    }
    context.globalAlpha = tilesAlpha
    data.jamo.forEach((item, index) => {
      const from: Point = [rowLeft + item.cell * cell + (item.box.x1 + item.box.x2) / 2 * k, rowUp + (item.box.y1 + item.box.y2) / 2 * k]
      drawFlight(from, tileCentre(index), span(collect, collectStart(index), collectStart(index) + TRAVEL + 0.2))
    })
  }

  // The syllables the written cells compose. Three are composed slowly, with the zone of each jamo. Then lines keep leaving the tiles,
  // and syllable after syllable is composed in a field under a count, the later ones over the earlier ones.
  const figureY = top + room * 0.24
  const spread = ease(span(compose, GATHER, GATHER + 0.7))
  const seats = Math.ceil(data.stream.length / 2)
  const places = data.composed.length + seats
  const fieldTop = figureY + 60
  let patch = 96
  while (patch > 24 && Math.ceil(places / Math.floor((width - pad * 2) / patch)) * patch > top + room - fieldTop) patch -= 2
  const perRow = Math.max(1, Math.floor((width - pad * 2) / patch))
  const fieldLeft = (width - Math.min(places, perRow) * patch) / 2
  const patchAt = (index: number): Point => [fieldLeft + index % perRow * patch, fieldTop + Math.floor(index / perRow) * patch]
  /** A syllable of the field gives way to the sentence, the first places first. */
  const kept = (index: number) => 1 - span(type, FIELD_END + index * 0.01, FIELD_END + 0.4 + index * 0.01)
  /** A jamo of a composed syllable in font units, drawn as far as the pen has come. */
  const drawRole = (role: ComposedRole, drawn: number) => {
    if (drawn <= 0) return
    if (drawn >= 1) { context.fill(role.path); return }
    context.save()
    context.clip(role.path)
    context.lineWidth = role.width
    let before = 0
    for (const line of role.lines) {
      const length = line.lengths.at(-1)!
      const reached = drawn * role.length - before
      before += length
      if (reached <= 0) break
      context.beginPath()
      trace(line.points, line.lengths, Math.min(length, reached))
      context.stroke()
    }
    context.restore()
  }
  const slotsAlpha = ease(span(compose, 0.3, 0.8))
  if (slotsAlpha > 0 && kept(places) > 0) {
    data.composed.forEach((syllable, s) => {
      const [toX, toY] = patchAt(s)
      const side = mix(slot, patch, spread)
      const left = mix(slotsLeft + s * (slot + slotGap), toX, spread)
      const upper = mix(slotsTop, toY, spread)
      const scale = side * EM_FIT / 1000
      const originX = left + side * (1 - EM_FIT) / 2
      const originY = upper + side * (1 - EM_FIT) / 2 + 900 * scale
      const alpha = slotsAlpha * kept(s)
      view()
      context.globalAlpha = alpha * (1 - spread)
      context.fillStyle = '#fff'
      context.fillRect(Math.round(left), Math.round(upper), Math.round(side), Math.round(side))
      context.strokeStyle = RULE
      context.lineWidth = 1
      context.strokeRect(Math.round(left) + 0.5, Math.round(upper) + 0.5, Math.round(side), Math.round(side))
      syllable.forEach((role, r) => {
        const drawn = span(compose, roleStarts[s][r] + TRAVEL, roleStarts[s][r] + TRAVEL + DRAW)
        view(scale, -scale, originX, originY)
        const placed = ease(span(compose, 0.5 + s * 0.1, 1 + s * 0.1)) * (1 - drawn)
        if (role.zone && placed > 0) {
          const { x1, y1, x2, y2 } = role.zone
          context.strokeStyle = INK
          context.lineWidth = 1 / scale
          if (role.role === 'medial') {
            context.globalAlpha = alpha * placed * 0.3
            context.fillStyle = LIME
            context.fillRect(x1, y1, x2 - x1, y2 - y1)
          } else {
            context.globalAlpha = alpha * placed * 0.5
            context.setLineDash(role.role === 'final' ? [4 / scale, 3 / scale] : [])
            context.strokeRect(x1, y1, x2 - x1, y2 - y1)
            context.setLineDash([])
          }
        }
        context.globalAlpha = alpha
        context.fillStyle = INK
        context.strokeStyle = INK
        drawRole(role, drawn)
        drawFlight(tileCentre(role.source), [originX + (role.box.x1 + role.box.x2) / 2 * scale, originY - (role.box.y1 + role.box.y2) / 2 * scale], span(compose, roleStarts[s][r], roleStarts[s][r] + TRAVEL + 0.2))
      })
    })

    // The places are taken in a scattered order, so the lines cross the whole field.
    const order = Array.from({ length: seats }, (_, index) => index).sort((a, b) => scatter(a * 7.7 + 1) - scatter(b * 7.7 + 1))
    const scale = patch * EM_FIT / 1000
    data.stream.forEach((syllable, index) => {
      const start = streamStart(index)
      if (compose < start) return
      const at = data.composed.length + order[index % seats]
      const [x, y] = patchAt(at)
      const originX = x + patch * (1 - EM_FIT) / 2
      const originY = y + patch * (1 - EM_FIT) / 2 + 900 * scale
      const covered = index + seats < data.stream.length ? span(compose, streamStart(index + seats), streamStart(index + seats) + 0.4) : 0
      syllable.forEach((role, r) => {
        const begin = start + r * 0.05
        view(scale, -scale, originX, originY)
        context.globalAlpha = kept(at) * mix(1, 0.12, covered)
        context.fillStyle = INK
        context.strokeStyle = INK
        drawRole(role, span(compose, begin + 0.26, begin + 0.56))
        context.globalAlpha = kept(at)
        drawFlight(tileCentre(role.source), [originX + (role.box.x1 + role.box.x2) / 2 * scale, originY - (role.box.y1 + role.box.y2) / 2 * scale], span(compose, begin, begin + 0.4))
      })
    })
  }

  // The count: the syllables the written cells compose, then all of modern Hangul once every sentence is written.
  const counted = ease(span(compose, GATHER, GATHER + 0.5)) * exit
  if (counted > 0) {
    const some = mix(data.composed.length, data.composable, span(compose, STREAM_START, TYPE - COMPOSE) ** 2)
    const value = mix(some, SYLLABLES, easeInOut(span(type, 0.2, 1.6)))
    view()
    context.globalAlpha = counted
    context.fillStyle = INK
    context.font = `800 44px ${FONT}`
    context.textAlign = 'right'
    context.fillText(Math.round(value).toLocaleString('en-US'), centreX + 52, figureY)
    context.font = `600 14px ${FONT}`
    context.textAlign = 'left'
    context.fillStyle = INK_2
    context.fillText('자', centreX + 58, figureY)
    context.font = `600 12px ${FONT}`
    context.textAlign = 'center'
    context.globalAlpha = counted * (1 - span(type, 0, 0.3))
    context.fillText(`쓴 ${data.measures.length}글자의 자모로 만든 글자`, centreX, figureY + 42)
    context.globalAlpha = counted * span(type, 0.3, 0.6)
    context.fillText('문장 8개를 다 썼을 때', centreX, figureY + 42)
    context.globalAlpha = counted * 0.15
    context.fillStyle = INK
    context.beginPath()
    context.roundRect(centreX - 120, figureY + 16, 240, 6, 3)
    context.fill()
    context.globalAlpha = counted
    context.beginPath()
    context.roundRect(centreX - 120, figureY + 16, Math.max(6, 240 * value / SYLLABLES), 6, 3)
    context.fill()
  }

  // The font: a sentence is typed in it, one character at a time.
  if (type > 0) {
    const line = data.lines[frame.line % data.lines.length]
    const em = Math.min(104, (width - pad * 2) * 860 / line.width, room * 0.3)
    const unit = em / 1000
    const left = (width - line.width * unit) / 2
    const baseline = top + room * 0.66 + em * 0.34
    const typed = Math.floor((type - TYPE_START) / TYPE_STEP)
    context.globalAlpha = exit
    drawFlight([centreX, figureY + 50], [left, baseline - em * 0.4], span(type, FIELD_END + 0.2, TYPE_START + 0.05))
    context.fillStyle = INK
    for (const glyph of line.glyphs) {
      const shown = ease(span(type, TYPE_START + glyph.index * TYPE_STEP, TYPE_START + glyph.index * TYPE_STEP + 0.14))
      if (shown <= 0) continue
      context.globalAlpha = shown * exit
      view(unit, -unit, left + glyph.x * unit, baseline + (1 - shown) * em * 0.06)
      context.fill(glyph.path)
    }
    const resting = typed >= line.pens.length
    if (type >= TYPE_START && (!resting || Math.floor((type - TYPE_START - line.pens.length * TYPE_STEP) / 0.53) % 2 === 0)) {
      view()
      context.globalAlpha = exit
      context.fillRect(Math.round(left + line.pens[Math.min(typed, line.pens.length - 1)] * unit) + 2, baseline - em * 0.86, 2, em * 1.02)
    }
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.globalAlpha = 1
}
