// node tools/sample/generate.mjs [--style=tidy|example] [--seed=7] [--out=src/dev/sample-project.json] [--strokes=<file>] [--keep-latin=<strokes file>]
// Makes the strokes of a sample project from the rules in handwriting.mjs, saves them through the app's own save path,
// and writes one review sheet per group in tools/out/sample-<style>-*.svg. See tools/README.md and docs/decision/0004.
import { readFileSync, writeFileSync } from 'node:fs'
import { writeOut } from '../lib/out.mjs'
import { startVite } from '../lib/vite.mjs'
import { CELL, createRng, rawStroke, useStyle, writeLatin, writeSyllable } from './handwriting.mjs'

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const seed = Number(arg('seed', '7'))
const styleName = arg('style', 'tidy')
const style = useStyle(styleName)
const out = arg('out', 'src/dev/sample-project.json')
const strokesOut = arg('strokes', '')
const keepLatin = arg('keep-latin', '')
const COLUMNS = 6
const STROKE_WIDTH = style.pen
const EMPTY_GUIDE = { roles: {}, placeholders: {}, bands: {} }

const server = await startVite()
try {
  const { WRITING_EXERCISES } = await server.ssrLoadModule('/src/collection/exercises.ts')
  const { promptRole } = await server.ssrLoadModule('/src/collection/prompts.ts')
  const { decomposeHangul, isHangulSyllable } = await server.ssrLoadModule('/src/font/hangul.ts')
  const { assignStrokes, captureRecords } = await server.ssrLoadModule('/src/features/writing/stroke-assignment.ts')
  const { projectStore, projectActions } = await server.ssrLoadModule('/src/project/store.ts')
  const { splitProject } = await server.ssrLoadModule('/src/project/saved-format.ts')
  const { completedHangulCells } = await server.ssrLoadModule('/src/generation/learning/samples.ts')
  const { missingPrompts } = await server.ssrLoadModule('/src/collection/prompts.ts')

  const rng = createRng(seed)
  const kept = keepLatin ? JSON.parse(readFileSync(keepLatin, 'utf8')) : null
  projectActions.startProject()
  const grid = { cellSize: CELL, columns: COLUMNS }
  let tightest = { gap: Infinity, char: '' }
  const tight = []
  let joinedCells = 0

  for (const exercise of WRITING_EXERCISES) {
    const strokes = []
    const guides = {}
    const boundaries = {}
    // The hand drifts a little along the line.
    let drift = 0
    exercise.cells.forEach((cell, cellIndex) => {
      if (!cell.slots.length) return
      const codePoint = cell.char.codePointAt(0)
      drift = drift * 0.7 + rng.gauss() * 1.2
      let cellStrokes
      let counts = []
      if (isHangulSyllable(codePoint)) {
        const written = writeSyllable(decomposeHangul(codePoint), rng)
        if (written.gap < tightest.gap) tightest = { gap: written.gap, char: cell.char }
        if (written.gap < style.minimum) tight.push(`${cell.char} ${written.gap.toFixed(1)}`)
        cellStrokes = ['initial', 'medial', 'final'].flatMap((role) => written.roles[role])
        counts = cell.slots.map((slot) => written.roles[slot.role].length)
      } else {
        cellStrokes = writeLatin(cell.char, rng)
      }
      const originX = cellIndex % COLUMNS * CELL
      const originY = Math.floor(cellIndex / COLUMNS) * CELL
      const first = strokes.length
      for (const points of cellStrokes) strokes.push(rawStroke(points.map(([x, y]) => [originX + x, originY + y + drift * style.drift]), rng, STROKE_WIDTH))
      // A jamo written with another stroke count than usual needs its end declared, as a writer does in the cell popover.
      if (counts.some((count, index) => count !== cell.slots[index].expectedStrokes)) {
        let end = first
        boundaries[cellIndex] = cell.slots.slice(0, -1).map((slot, slotIndex) => {
          end += counts[slotIndex]
          return { slotIndex, promptId: slot.promptId, afterElementId: strokes[end - 1].id, confirmedAt: 0 }
        })
        joinedCells += 1
      }
      guides[cellIndex] = EMPTY_GUIDE
    })
    if (kept && exercise.group !== 'hangul') strokes.splice(0, strokes.length, ...kept.sessions.find((session) => session.exerciseId === exercise.id).elements.map((stroke) => ({ ...stroke, strokeWidth: STROKE_WIDTH })))
    const state = projectStore.state
    const assigned = assignStrokes(strokes, grid, exercise, state.drawings, boundaries, { mode: 'blank', pinned: {} })
    projectActions.saveSentenceCapture({
      exerciseId: exercise.id, text: exercise.text, elements: strokes,
      assignments: assigned.assignments, boundaries: assigned.boundaries,
      cellSize: CELL, columns: COLUMNS, updatedAt: Date.now(), guides,
    }, captureRecords(assigned.groups, grid, exercise.id, state.compositionSettings.endpointStabilization))
  }

  const project = splitProject(projectStore.state)
  writeFileSync(out, JSON.stringify(project))
  if (strokesOut) writeFileSync(strokesOut, JSON.stringify({ sessions: WRITING_EXERCISES.map((exercise) => ({ exerciseId: exercise.id, cellSize: CELL, columns: COLUMNS, elements: project.sessions[exercise.id].elements, boundaries: project.sessions[exercise.id].boundaries })) }))

  const colors = { initial: '#2563eb', medial: '#c02673', final: '#16834b' }
  const sheet = (name, exercises, columns) => {
    let row = 0
    let body = ''
    for (const exercise of exercises) {
      const session = project.sessions[exercise.id]
      body += `<text x="6" y="${row * CELL + 16}" font-size="13" fill="#666">${exercise.id}</text>`
      const cells = exercise.cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => cell.slots.length)
      cells.forEach(({ cell, index }, order) => {
        const x = order % columns * CELL
        const y = (row + Math.floor(order / columns)) * CELL + 20
        body += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="none" stroke="#ddd"/><path d="M${x + CELL / 2} ${y}v${CELL}M${x} ${y + CELL / 2}h${CELL}" stroke="#f0f0f0"/><text x="${x + 4}" y="${y + 14}" font-size="11" fill="#999">${cell.char.replace('&', '&amp;').replace('<', '&lt;')}</text>`
        for (const capture of session.captures.filter((record) => record.capture.cellIndex === index)) {
          const fill = colors[promptRole(capture.promptId)] ?? '#111'
          for (const path of capture.paths) body += `<path d="${path.d}" transform="translate(${x + path.x} ${y + path.y})" fill="${fill}"/>`
        }
      })
      row += Math.ceil(cells.length / columns) + 0.25
    }
    writeOut(`${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${columns * CELL} ${Math.ceil(row * CELL + 24)}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`)
  }
  const hangul = WRITING_EXERCISES.filter((exercise) => exercise.group === 'hangul')
  sheet(`sample-${styleName}-hangul-1`, hangul.slice(0, 2), 10)
  sheet(`sample-${styleName}-hangul-2`, hangul.slice(2, 4), 10)
  sheet(`sample-${styleName}-hangul-3`, hangul.slice(4), 10)
  sheet(`sample-${styleName}-latin`, WRITING_EXERCISES.filter((exercise) => exercise.group !== 'hangul'), 10)

  const state = projectStore.state
  const complete = completedHangulCells(state.writingSessions).length
  const syllables = hangul.reduce((sum, exercise) => sum + exercise.cells.filter((cell) => cell.slots.length).length, 0)
  console.log(`${out}: sessions=${Object.keys(project.sessions).length} drawings=${Object.keys(project.drawings).length} strokes=${Object.values(project.sessions).reduce((sum, session) => sum + session.elements.length, 0)}`)
  console.log(`cells with declared jamo ends: ${joinedCells}`)
  console.log(`complete syllables ${complete}/${syllables}; missing required prompts: ${missingPrompts(state.drawings).map((prompt) => prompt.id).join(' ') || 'none'}`)
  console.log(`tightest jamo gap ${tightest.gap.toFixed(1)}px (${tightest.char}); below the minimum: ${tight.join(', ') || 'none'}`)
} finally { await server.close() }
