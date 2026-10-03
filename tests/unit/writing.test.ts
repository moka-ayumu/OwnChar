import { beforeEach, describe, expect, test } from 'vitest'
import { WRITING_EXERCISES } from '@/collection/exercises'
import type { DrawingRecord } from '@/collection/records'
import { assignStrokes, captureRecords, editableSlots } from '@/features/writing/stroke-assignment'
import { projectActions, projectStore } from '@/project/store'
import { CELL, penStroke } from './helpers'

// 배고픈 너구리가 …: 배 = ㅂ(4 strokes) + ㅐ(3), 고 = ㄱ(1) + ㅗ(2).
const exercise = WRITING_EXERCISES[0]
const grid = { cellSize: CELL, columns: 6 }
const id = (role: string, variant: number, char: string) => `${role}-${variant}-${char.codePointAt(0)}`
/** A stroke starting in cell `cell` of the first row. */
const strokeIn = (name: string, cell: number, dx = 30) => penStroke(name, cell * CELL + dx, 40, [[0, 0], [20, 0]])

describe('stroke assignment', () => {
  test('strokes go to the cell they start in and fill its jamo in order, by their usual stroke counts', () => {
    // A stroke of 고 that ends in the next cell still belongs to 고.
    const strokes = [strokeIn('a', 1), penStroke('b', 1 * CELL + 100, 60, [[0, 0], [80, 0]]), strokeIn('c', 1), strokeIn('d', 1)]
    const { groups, assignments } = assignStrokes(strokes, grid, exercise, {}, {})
    expect(assignments.map((item) => [item.elementId, item.promptId])).toEqual([
      ['a', id('initial', 1, 'ㄱ')],
      ['b', id('medial', 0, 'ㅗ')],
      ['c', id('medial', 0, 'ㅗ')],
      // The last jamo takes every further stroke.
      ['d', id('medial', 0, 'ㅗ')],
    ])
    const records = captureRecords(groups, grid, exercise.id, 1)
    expect(records.map((record) => record.promptId)).toEqual([id('initial', 1, 'ㄱ'), id('medial', 0, 'ㅗ')])
    expect(records[0].capture).toEqual({ exerciseId: exercise.id, cellIndex: 1, slotIndex: 0 })
    // Display paths are positioned inside the cell.
    expect(records[0].paths[0].x).toBe(30)
    expect(records[0].previewSvg).toContain('fill-rule="nonzero"')
  })

  test('a confirmed boundary ends a jamo early, until the stroke it was set on is erased', () => {
    // ㅂ is usually four strokes; here it is finished after one.
    const strokes = [strokeIn('a', 0), strokeIn('b', 0)]
    const boundary = { slotIndex: 0, promptId: id('initial', 0, 'ㅂ'), afterElementId: 'a', confirmedAt: 0 }
    const confirmed = assignStrokes(strokes, grid, exercise, {}, { 0: [boundary] })
    expect(confirmed.assignments.map((item) => item.promptId)).toEqual([id('initial', 0, 'ㅂ'), id('medial', 0, 'ㅐ')])
    expect(confirmed.boundaries).toEqual({ 0: [boundary] })

    const erased = assignStrokes([{ ...strokes[0], isDeleted: true }, strokes[1]], grid, exercise, {}, { 0: [boundary] })
    expect(erased.assignments.map((item) => item.promptId)).toEqual([id('initial', 0, 'ㅂ')])
    expect(erased.boundaries).toEqual({})
  })

  test('a jamo already captured in another cell is fixed here, and strokes go to the jamo still missing', () => {
    // 가's initial has been captured in some other cell.
    const cellIndex = exercise.cells.findIndex((cell) => cell.char === '가')
    const [initial, medial] = exercise.cells[cellIndex].slots
    const captured = { [initial.promptId]: { capture: { exerciseId: exercise.id, cellIndex: 99, slotIndex: 0 } } as DrawingRecord }
    expect(editableSlots(exercise.cells[cellIndex], cellIndex, exercise, captured).map(({ slot }) => slot.promptId)).toEqual([medial.promptId])
    const { assignments } = assignStrokes([penStroke('a', (cellIndex % 6) * CELL + 30, Math.floor(cellIndex / 6) * CELL + 40, [[0, 0], [20, 0]])], grid, exercise, captured, {})
    expect(assignments.map((item) => item.promptId)).toEqual([medial.promptId])
  })
})

describe('project store', () => {
  const drawing = (promptId: string, cellIndex: number, previewSvg = promptId): DrawingRecord => ({
    promptId, codePoint: Number(promptId.split('-').at(-1)), elements: [], paths: [], previewSvg, updatedAt: 0,
    capture: { exerciseId: exercise.id, cellIndex, slotIndex: 0 },
  })
  const session = { exerciseId: exercise.id, text: exercise.text, elements: [], assignments: [], boundaries: {}, cellSize: CELL, columns: 6, updatedAt: 0, guides: {} }
  const rieul = 'ㄹ'.codePointAt(0)
  beforeEach(() => projectActions.startProject())

  test('a captured contextual jamo also becomes the standalone jamo, preferring the open-syllable form', () => {
    projectActions.saveSentenceCapture(session, [drawing(id('initial', 0, 'ㄹ'), 5)])
    expect(projectStore.state.drawings[`consonant-${rieul}`].derivedFromPromptId).toBe(id('initial', 0, 'ㄹ'))
    expect(projectStore.state.sourceDirty).toBe(true)

    // ㄹ over a final is a worse stand-in than the open-syllable ㄹ already in use.
    projectActions.saveSentenceCapture(session, [drawing(id('initial', 0, 'ㄹ'), 5), drawing(id('initial', 6, 'ㄹ'), 13)])
    const standalone = projectStore.state.drawings[`consonant-${rieul}`]
    expect(standalone.derivedFromPromptId).toBe(id('initial', 0, 'ㄹ'))
    expect(standalone.capture.cellIndex).toBe(5)
    // Both contextual forms stay separate drawings.
    expect(projectStore.state.drawings[id('initial', 6, 'ㄹ')].capture.cellIndex).toBe(13)

    // Erasing a jamo from the sentence removes its drawing and whatever was derived from it.
    projectActions.saveSentenceCapture(session, [])
    expect(projectStore.state.drawings).toEqual({})
  })

  test('glyph overrides are undone and redone as one step per change', () => {
    projectActions.applyGlyphTransform([0xac00, 0xac01], { left: 12 })
    projectActions.applyGlyphTransform([0xac00], { scale: 1.2 })
    expect(projectStore.state.glyphOverrides[0xac00]).toMatchObject({ left: 12, scale: 1.2 })
    projectActions.resetAllGlyphTransforms()
    expect(projectStore.state.glyphOverrides).toEqual({})
    projectActions.undo()
    projectActions.undo()
    expect(projectStore.state.glyphOverrides[0xac00]).toMatchObject({ left: 12, scale: 1 })
    expect(projectStore.state.glyphOverrides[0xac01]).toMatchObject({ left: 12 })
    projectActions.redo()
    expect(projectStore.state.glyphOverrides[0xac00].scale).toBe(1.2)
  })

  test('only a project saved in the current format is opened', () => {
    const saved = { ...projectStore.state, currentExercise: 3 }
    projectActions.restoreProject({ ...saved, schemaVersion: 0 as never })
    expect(projectStore.state.currentExercise).toBe(0)
    expect(projectStore.state.status).toBe('empty')
    projectActions.restoreProject(saved)
    expect(projectStore.state.currentExercise).toBe(3)
    expect(projectStore.state.hydrated).toBe(true)
  })
})
