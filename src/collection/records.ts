import type { StoredCellGuide } from '@/font/guides'
import type { RawStroke } from '@/font/stroke/outline'

/** SVG outline of one stroke, positioned inside its writing cell; used for display only. */
export interface StrokePath {
  d: string
  x: number
  y: number
  width: number
  height: number
}

/** The captured strokes of one prompt, with where in which sentence they were written. */
export interface DrawingRecord {
  promptId: string
  codePoint: number
  /** Raw strokes in the canvas coordinates of their sentence. */
  elements: readonly RawStroke[]
  paths: StrokePath[]
  previewSvg: string
  updatedAt: number
  capture: {
    exerciseId: string
    cellIndex: number
    slotIndex: number
  }
  /** Set on a base jamo that stands in for the contextual jamo it was copied from. */
  derivedFromPromptId?: string
}

export interface StrokeAssignment {
  elementId: string
  cellIndex: number
  slotIndex: number
  promptId: string
}

/** A point where the writer declared one jamo finished and the next begun. */
export interface JamoBoundary {
  slotIndex: number
  promptId: string
  afterElementId: string
  confirmedAt: number
}

/** Raw, replayable input of one sentence canvas. */
export interface WritingSessionRecord {
  exerciseId: string
  text: string
  elements: readonly RawStroke[]
  assignments: StrokeAssignment[]
  boundaries: Record<number, JamoBoundary[]>
  cellSize: number
  columns: number
  updatedAt: number
  /** Fixed guide jamo of each written cell, kept exactly where they were shown. */
  guides: Record<number, StoredCellGuide>
}

export function cellId(exerciseId: string, cellIndex: number) {
  return `${exerciseId}:${cellIndex}`
}

/** Top-left corner of a cell on its sentence canvas. */
export function cellOrigin(cellIndex: number, columns: number, cellSize: number) {
  return { x: (cellIndex % columns) * cellSize, y: Math.floor(cellIndex / columns) * cellSize }
}

/** Identifies the drawing a guide outline was made from; it changes only when the jamo is rewritten. */
export function guideSourceTag(record: DrawingRecord | undefined) {
  if (!record) return ''
  const content = record.previewSvg || JSON.stringify(record.paths)
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${record.promptId}:${(hash >>> 0).toString(36)}`
}
