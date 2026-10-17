import { readFileSync } from 'node:fs'
import { startVite } from './vite.mjs'

const example = new URL('../../src/features/samples/example.json', import.meta.url)

/** Builds the project of the example handwriting through the app's own save path, as the home page does. */
export async function loadProject() {
  const { sessions } = JSON.parse(readFileSync(example, 'utf8'))
  const server = await startVite()
  try {
    const { WRITING_EXERCISES } = await server.ssrLoadModule('/src/collection/exercises.ts')
    const { assignStrokes, captureRecords } = await server.ssrLoadModule('/src/features/writing/stroke-assignment.ts')
    const { projectStore, projectActions } = await server.ssrLoadModule('/src/project/store.ts')
    projectActions.startProject()
    for (const { exerciseId, cellSize, columns, elements, boundaries } of sessions) {
      const exercise = WRITING_EXERCISES.find((item) => item.id === exerciseId)
      if (!exercise) continue
      const state = projectStore.state
      const grid = { cellSize, columns }
      const assigned = assignStrokes(elements, grid, exercise, state.drawings, boundaries, { mode: state.guideMode, pinned: {} })
      const guides = {}
      for (const { cellIndex } of assigned.assignments) guides[cellIndex] = { roles: {}, placeholders: {}, bands: {} }
      projectActions.saveSentenceCapture({
        exerciseId, text: exercise.text, elements,
        assignments: assigned.assignments, boundaries: assigned.boundaries,
        cellSize, columns, updatedAt: Date.now(), guides,
      }, captureRecords(assigned.groups, grid, exerciseId, state.compositionSettings.endpointStabilization))
    }
    return structuredClone(projectStore.state)
  } finally { await server.close() }
}
