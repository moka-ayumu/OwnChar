import opentype from 'opentype.js'
import { describe, expect, test } from 'vitest'
import { GlyphEncoder, NOTDEF, writeOtf } from '@/generation/otf-writer'

const metadata = { familyName: 'Writer', styleName: 'Regular', designer: 'Tester', version: '1.0' }

function outline(seed: number) {
  const path = new opentype.Path()
  path.moveTo(100.4 + seed, -20.6)
  path.lineTo(900.5, 12.5 + seed)
  path.quadTo(1300.2, 400.7, 640.1 - seed, 880.9)
  path.curveTo(300.3, 950.2, 120.8, 700.1 + seed, -150.6, 333.3)
  path.close()
  path.moveTo(400, 400)
  path.lineTo(500 + seed, 400)
  path.lineTo(450, 4000.2)
  for (let index = 0; index < 30; index += 1) path.lineTo(450 - index * 3, 3000 - index * seed)
  path.close()
  return path
}

/** The same glyphs as opentype.js writes them and as blocks for the writer. */
function fixture(count: number, compact = false) {
  const glyphs = [new opentype.Glyph({ name: '.notdef', index: 0, advanceWidth: 700, path: outline(0) })]
  const first = new GlyphEncoder(compact)
  const second = new GlyphEncoder(compact)
  first.add(NOTDEF, outline(0), 700)
  glyphs.push(new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 400, path: new opentype.Path() }))
  first.add(32, new opentype.Path(), 400)
  for (let index = 0; index < count; index += 1) {
    const codePoint = 0xac00 + index
    const advanceWidth = index % 3 ? 1000 : 612.75 + index
    glyphs.push(new opentype.Glyph({ name: `uni${codePoint.toString(16).toUpperCase()}`, unicode: codePoint, advanceWidth, path: outline(index) }))
    ;(index < count / 2 ? first : second).add(codePoint, outline(index), advanceWidth)
  }
  const font = new opentype.Font({ ...metadata, manufacturer: 'OwnChar', unitsPerEm: 1000, ascender: 900, descender: -100, glyphs })
  return { expected: new Uint8Array(font.toArrayBuffer()), blocks: [first.finish(), second.finish()] }
}

describe('font file', () => {
  test('charstrings written directly give the file opentype.js writes from the outlines', () => {
    // Enough charstring data that the INDEX needs two-byte and then three-byte offsets.
    for (const count of [3, 40, 1200]) {
      const { expected, blocks } = fixture(count)
      expect(new Uint8Array(writeOtf(metadata, blocks))).toEqual(expected)
    }
  })

  test('lines sharing an operator are read back as the same outlines from a smaller file', () => {
    const plain = writeOtf(metadata, fixture(40).blocks)
    const compact = writeOtf(metadata, fixture(40, true).blocks)
    expect(compact.byteLength).toBeLessThan(plain.byteLength)
    const outlines = (buffer: ArrayBuffer) => { const font = opentype.parse(buffer); return Array.from({ length: font.glyphs.length }, (_, index) => font.glyphs.get(index).path.commands) }
    expect(outlines(compact)).toEqual(outlines(plain))
  })

  test('the written font is read back with every outline, width and code point', () => {
    const { blocks } = fixture(40, true)
    const font = opentype.parse(writeOtf(metadata, blocks))
    expect(font.glyphs.length).toBe(42)
    const glyph = font.charToGlyph(String.fromCodePoint(0xac00 + 7))
    expect(glyph.advanceWidth).toBe(1000)
    expect(glyph.path.commands.filter((command) => command.type === 'M')).toHaveLength(2)
    expect(glyph.getBoundingBox().y2).toBe(4000)
    expect(font.charToGlyph(' ').path.commands).toHaveLength(0)
  })
})
