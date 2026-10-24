import opentype from 'opentype.js'
import { ByteWriter, writeCharstring } from '@/font/geometry/charstring'
import { controlPoints } from '@/font/geometry/path-ops'
import { DESCENDER_LIMIT } from '@/font/glyphs/calibration'
import type { LigatureRule } from './custom-glyphs'
import type { FontMetadata } from './request'

/**
 * Finished glyphs as bytes: nothing of their outlines is kept but the
 * charstrings and the numbers the font tables need. Every field is a typed
 * array, so a worker hands the whole set over without copying it.
 */
export interface EncodedGlyphs {
  /** Unicode of each glyph; -1 for .notdef. */
  codePoints: Int32Array
  advanceWidths: Float64Array
  /** x1, y1, x2, y2 of each glyph's control points; NaN without ink. */
  boxes: Float64Array
  /** Where each glyph's charstring ends in `charstrings`. */
  ends: Uint32Array
  charstrings: Uint8Array
}

export const NOTDEF = -1

/** Collects glyphs one at a time into an `EncodedGlyphs`. */
export class GlyphEncoder {
  private codePoints: number[] = []
  private advanceWidths: number[] = []
  private boxes: number[] = []
  private ends: number[] = []
  private charstrings = new ByteWriter()

  /** Without `compact` the charstrings are written operator for operator as opentype.js writes them. */
  constructor(private compact = true) {}

  add(codePoint: number, path: opentype.Path, advanceWidth: number) {
    const points = controlPoints(path.commands)
    let x1 = NaN; let y1 = NaN; let x2 = NaN; let y2 = NaN
    for (const [x, y] of points) {
      if (!(x >= x1)) x1 = x
      if (!(y >= y1)) y1 = y
      if (!(x <= x2)) x2 = x
      if (!(y <= y2)) y2 = y
    }
    writeCharstring(this.charstrings, path.commands, advanceWidth, this.compact)
    this.codePoints.push(codePoint)
    this.advanceWidths.push(advanceWidth)
    this.boxes.push(x1, y1, x2, y2)
    this.ends.push(this.charstrings.length)
  }

  get count() {
    return this.codePoints.length
  }

  finish(): EncodedGlyphs {
    return {
      codePoints: Int32Array.from(this.codePoints),
      advanceWidths: Float64Array.from(this.advanceWidths),
      boxes: Float64Array.from(this.boxes),
      ends: Uint32Array.from(this.ends),
      charstrings: this.charstrings.finish(),
    }
  }
}

export function transferables(glyphs: EncodedGlyphs): ArrayBuffer[] {
  return [glyphs.codePoints, glyphs.advanceWidths, glyphs.boxes, glyphs.ends, glyphs.charstrings].map((array) => array.buffer as ArrayBuffer)
}

function glyphName(codePoint: number) {
  if (codePoint === NOTDEF) return '.notdef'
  if (codePoint === 32) return 'space'
  return `uni${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * The font with every outline reduced to the two corners of its box. All
 * tables but `CFF ` depend on a glyph only through its box, width and code
 * point, so opentype.js writes them here exactly as it would for the real font.
 */
function skeletonFont(metadata: FontMetadata, blocks: EncodedGlyphs[], ligatures: LigatureRule[]) {
  const glyphs: opentype.Glyph[] = []
  for (const block of blocks) {
    for (let index = 0; index < block.codePoints.length; index += 1) {
      const codePoint = block.codePoints[index]
      const path = new opentype.Path()
      if (!Number.isNaN(block.boxes[index * 4])) {
        path.moveTo(block.boxes[index * 4], block.boxes[index * 4 + 1])
        path.lineTo(block.boxes[index * 4 + 2], block.boxes[index * 4 + 3])
      }
      glyphs.push(new opentype.Glyph({
        name: glyphName(codePoint), index: glyphs.length, unicode: codePoint === NOTDEF ? undefined : codePoint,
        advanceWidth: block.advanceWidths[index], path,
      }))
    }
  }
  const font = new opentype.Font({
    familyName: metadata.familyName,
    styleName: metadata.styleName,
    designer: metadata.designer,
    manufacturer: 'OwnChar',
    version: metadata.version,
    unitsPerEm: 1000,
    ascender: 900,
    descender: DESCENDER_LIMIT,
    glyphs,
  })
  const indexOf = new Map(glyphs.flatMap((glyph) => glyph.unicode === undefined ? [] : [[glyph.unicode, glyph.index] as const]))
  // A run of characters the font does not hold has nothing to replace.
  const rules = ligatures.flatMap(({ sequence, by }) => {
    const sub = sequence.map((codePoint) => indexOf.get(codePoint))
    const ligature = indexOf.get(by)
    return ligature !== undefined && sub.every((index) => index !== undefined) ? [{ sub: sub as number[], by: ligature }] : []
  })
  // Reading the substitution table makes an empty one, so a font without ligatures does not touch it.
  if (rules.length) {
    // The installed type declarations predate the substitution table of opentype.js 2.
    const substitution = font.substitution as unknown as { addLigature(feature: string, ligature: { sub: number[]; by: number }): void }
    for (const rule of rules) substitution.addLigature('liga', rule)
  }
  return new Uint8Array(font.toArrayBuffer())
}

/** The CharStrings INDEX of all blocks: count, offset size, offsets from 1, data. */
function charStringsIndex(blocks: EncodedGlyphs[]) {
  const count = blocks.reduce((sum, block) => sum + block.codePoints.length, 0)
  const dataLength = blocks.reduce((sum, block) => sum + block.charstrings.length, 0)
  // The offset size opentype.js derives from the last offset.
  const offSize = (1 + Math.floor(Math.log(dataLength + 1) / Math.log(2)) / 8) | 0
  const index = new Uint8Array(3 + (count + 1) * offSize + dataLength)
  index[0] = count >> 8; index[1] = count & 255; index[2] = offSize
  let position = 3
  const offset = (value: number) => {
    for (let shift = (offSize - 1) * 8; shift >= 0; shift -= 8) index[position++] = value >>> shift & 255
  }
  let base = 1
  offset(base)
  for (const block of blocks) {
    for (const end of block.ends) offset(base + end)
    base += block.charstrings.length
  }
  for (const block of blocks) {
    index.set(block.charstrings, position)
    position += block.charstrings.length
  }
  return index
}

const uint32 = (bytes: Uint8Array, at: number) => (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0
function setUint32(bytes: Uint8Array, at: number, value: number) {
  bytes[at] = value >>> 24; bytes[at + 1] = value >>> 16 & 255; bytes[at + 2] = value >>> 8 & 255; bytes[at + 3] = value & 255
}

/** End of the CFF INDEX starting at `at`, and where its objects start and end. */
function readIndex(cff: Uint8Array, at: number) {
  const count = cff[at] << 8 | cff[at + 1]
  if (!count) return { end: at + 2, objects: [] as Array<[number, number]> }
  const offSize = cff[at + 2]
  const offsetAt = (index: number) => {
    let value = 0
    for (let byte = 0; byte < offSize; byte += 1) value = value * 256 + cff[at + 3 + index * offSize + byte]
    return value
  }
  const data = at + 3 + (count + 1) * offSize - 1
  const objects = Array.from({ length: count }, (_, index): [number, number] => [data + offsetAt(index), data + offsetAt(index + 1)])
  return { end: data + offsetAt(count), objects }
}

/** Where the Top DICT keeps the offsets of the CharStrings INDEX and the Private DICT. */
function topDictOffsets(cff: Uint8Array) {
  const names = readIndex(cff, cff[2])
  const [[start, end]] = readIndex(cff, names.end).objects
  let charStrings: number | undefined
  let privateDict: number | undefined
  let operands: number[] = []
  for (let at = start; at < end;) {
    const byte = cff[at]
    if (byte === 28) { operands.push(at); at += 3 }
    else if (byte === 29) { operands.push(at); at += 5 }
    else if (byte === 30) {
      operands.push(at)
      at += 1
      while ((cff[at] & 15) !== 15 && cff[at] >> 4 !== 15) at += 1
      at += 1
    }
    else if (byte >= 247 && byte <= 254) { operands.push(at); at += 2 }
    else if (byte >= 32) { operands.push(at); at += 1 }
    else {
      if (byte === 17) charStrings = operands.at(-1)
      if (byte === 18) privateDict = operands.at(-1)
      operands = []
      at += byte === 12 ? 2 : 1
    }
  }
  // Both are written as five-byte integers, so they can be changed in place.
  if (charStrings === undefined || privateDict === undefined || cff[charStrings] !== 29 || cff[privateDict] !== 29) throw new Error('Unexpected CFF Top DICT layout.')
  return { charStrings: charStrings + 1, privateDict: privateDict + 1 }
}

/** `cff` with its CharStrings INDEX replaced by `index`. */
function replaceCharStrings(cff: Uint8Array, index: Uint8Array) {
  const offsets = topDictOffsets(cff)
  const start = uint32(cff, offsets.charStrings)
  const tail = cff.subarray(uint32(cff, offsets.privateDict))
  const result = new Uint8Array(start + index.length + tail.length)
  result.set(cff.subarray(0, start))
  result.set(index, start)
  result.set(tail, start + index.length)
  setUint32(result, offsets.privateDict, start + index.length)
  return result
}

function checksum(bytes: Uint8Array) {
  let sum = 0
  for (let at = 0; at < bytes.length; at += 4) sum = (sum + uint32(bytes, at)) >>> 0
  return sum
}

/** `sfnt` with the table `tag` replaced by `replace(table)`, its directory and checksums brought up to date. */
function replaceTable(sfnt: Uint8Array, tag: string, replace: (table: Uint8Array) => Uint8Array) {
  const count = sfnt[4] << 8 | sfnt[5]
  const records = Array.from({ length: count }, (_, index) => {
    const at = 12 + index * 16
    return { at, tag: String.fromCharCode(...sfnt.subarray(at, at + 4)), offset: uint32(sfnt, at + 8), length: uint32(sfnt, at + 12) }
  })
  const tables = records.map((record) => {
    const bytes = sfnt.subarray(record.offset, record.offset + record.length)
    return { ...record, bytes: record.tag === tag ? replace(bytes) : bytes }
  }).sort((a, b) => a.offset - b.offset)
  const padded = (length: number) => (length + 3) & ~3
  const start = padded(12 + count * 16)
  const result = new Uint8Array(tables.reduce((sum, table) => sum + padded(table.bytes.length), start))
  result.set(sfnt.subarray(0, 12 + count * 16))
  let offset = start
  for (const table of tables) {
    result.set(table.bytes, offset)
    setUint32(result, table.at + 8, offset)
    setUint32(result, table.at + 12, table.bytes.length)
    if (table.tag === tag) setUint32(result, table.at + 4, checksum(result.subarray(offset, offset + padded(table.bytes.length))))
    if (table.tag === 'head') setUint32(result, offset + 8, 0)
    offset += padded(table.bytes.length)
  }
  const head = tables.find((table) => table.tag === 'head')
  if (!head) throw new Error('Could not find head table with checkSum to adjust.')
  setUint32(result, uint32(result, head.at + 8) + 8, (0xb1b0afba - checksum(result)) >>> 0)
  return result
}

/**
 * The OpenType file of `blocks`, whose first glyph is .notdef. opentype.js
 * writes every table from the glyphs' metrics; the charstrings, which it
 * would rebuild from millions of path commands, are put in as they are.
 */
export function writeOtf(metadata: FontMetadata, blocks: EncodedGlyphs[], ligatures: LigatureRule[] = []): ArrayBuffer {
  const index = charStringsIndex(blocks)
  return replaceTable(skeletonFont(metadata, blocks, ligatures),'CFF ', (cff) => replaceCharStrings(cff, index)).buffer as ArrayBuffer
}
