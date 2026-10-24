import opentype from 'opentype.js'
import { customChars, hasCustomInk, type CustomGlyph } from '@/collection/custom-glyphs'
import { translatePath } from '@/font/geometry/path-ops'
import { appendShape, CELL_UNITS, normalizeRawStrokes } from '@/font/geometry/shape'
import { isHangulSyllable } from '@/font/hangul'
import type { CompositionSettings } from '@/font/settings'

/** First code point of the private-use range that holds the glyphs of ligatures. */
export const LIGATURE_BASE = 0xe000

/** A glyph the writer drew, with the code point it takes in the font. */
export interface CustomEntry {
  codePoint: number
  glyph: CustomGlyph
  /** The code points it replaces, for a ligature. */
  sequence?: number[]
}

export interface LigatureRule {
  sequence: number[]
  by: number
}

/** The written glyphs in a fixed order, so a ligature keeps its private-use code point while the others stay as they are. */
export function customEntries(glyphs: Record<string, CustomGlyph> | undefined): CustomEntry[] {
  const written = Object.values(glyphs ?? {}).filter((glyph) => hasCustomInk(glyph.elements)).sort((a, b) => a.text < b.text ? -1 : 1)
  let ligatures = 0
  return written.map((glyph): CustomEntry => {
    const chars = customChars(glyph.text)
    if (chars.length === 1) return { codePoint: chars[0].codePointAt(0)!, glyph }
    return { codePoint: LIGATURE_BASE + ligatures++, glyph, sequence: chars.map((char) => char.codePointAt(0)!) }
  })
}

/** The syllables the writer fixed: they stand in for the composed ones. */
export function customSyllables(glyphs: Record<string, CustomGlyph> | undefined) {
  return new Map(customEntries(glyphs).filter((entry) => !entry.sequence && isHangulSyllable(entry.codePoint)).map((entry) => [entry.codePoint, entry.glyph]))
}

/** The glyphs that go in the base block: everything written but the syllables. */
export function customBaseEntries(glyphs: Record<string, CustomGlyph> | undefined) {
  return customEntries(glyphs).filter((entry) => entry.sequence || !isHangulSyllable(entry.codePoint))
}

/** The ligatures to put in the font, the longest first so that a shorter run does not hide a longer one. */
export function ligatureRules(glyphs: Record<string, CustomGlyph> | undefined): LigatureRule[] {
  return customEntries(glyphs).flatMap((entry) => entry.sequence ? [{ sequence: entry.sequence, by: entry.codePoint }] : [])
    .sort((a, b) => b.sequence.length - a.sequence.length)
}

/** Space left of the ink and right of it, in font units. */
const SIDE_BEARING = 55

/**
 * The strokes as an outline at the size and height they were written: the band of a cell is `CELL_UNITS` tall, and
 * ink above or below it stays there. The glyph is as wide as its ink wherever on the canvas it was written. Nothing
 * learned from the other handwriting scales it, so no size dial or normalization reaches it.
 */
export function customGlyph(glyph: CustomGlyph, settings: CompositionSettings) {
  const path = new opentype.Path()
  const shape = normalizeRawStrokes([...glyph.elements], glyph.cellSize, settings.endpointStabilization)
  if (!shape) return { path, advance: 0 }
  appendShape(path, shape, { x: 0, y: 0, width: CELL_UNITS, height: CELL_UNITS }, true)
  const box = path.getBoundingBox()
  translatePath(path, SIDE_BEARING - box.x1, 0)
  return { path, advance: box.x2 - box.x1 + 2 * SIDE_BEARING }
}

/** The advance of a syllable the writer fixed, or the usual one of a composed syllable. */
export function syllableAdvance(fixed: Map<number, CustomGlyph>, codePoint: number, settings: CompositionSettings) {
  const glyph = fixed.get(codePoint)
  return glyph ? customGlyph(glyph, settings).advance : 1000
}
