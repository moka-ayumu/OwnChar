import type opentype from 'opentype.js'

/** A byte buffer that grows as it is written. */
export class ByteWriter {
  private bytes = new Uint8Array(1024)
  length = 0

  private reserve(count: number) {
    if (this.length + count <= this.bytes.length) return
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + count))
    grown.set(this.bytes.subarray(0, this.length))
    this.bytes = grown
  }

  byte(value: number) {
    this.reserve(1)
    this.bytes[this.length++] = value
  }

  append(bytes: Uint8Array) {
    this.reserve(bytes.length)
    this.bytes.set(bytes, this.length)
    this.length += bytes.length
  }

  /** A CFF operand, in the shortest form that holds it. */
  number(value: number) {
    if (value >= -107 && value <= 107) this.byte(value + 139)
    else if (value >= 108 && value <= 1131) { const v = value - 108; this.byte((v >> 8) + 247); this.byte(v & 255) }
    else if (value >= -1131 && value <= -108) { const v = -value - 108; this.byte((v >> 8) + 251); this.byte(v & 255) }
    else if (value >= -32768 && value <= 32767) { this.byte(28); this.byte(value >> 8 & 255); this.byte(value & 255) }
    else { this.byte(29); this.byte(value >> 24 & 255); this.byte(value >> 16 & 255); this.byte(value >> 8 & 255); this.byte(value & 255) }
  }

  /** The written bytes, in a buffer of their own. */
  finish() {
    return this.bytes.slice(0, this.length)
  }
}

const RMOVETO = 21
const RLINETO = 5
const RRCURVETO = 8
const ENDCHAR = 14
/** Lines one rlineto can take: the argument stack holds 48 numbers. */
const LINES_PER_OPERATOR = 24

/**
 * Appends the Type 2 charstring of one glyph to `out`: its width, then every
 * point rounded to font units and written relative to the one before it.
 * Quadratic curves are raised to cubics. Consecutive lines share one
 * operator; without `compact` each has its own, and the bytes are those
 * opentype.js writes for the same path.
 */
export function writeCharstring(out: ByteWriter, commands: opentype.Path['commands'], advanceWidth: number, compact = true) {
  out.number(advanceWidth)
  let x = 0
  let y = 0
  let lines = 0
  const endLines = () => {
    if (lines) out.byte(RLINETO)
    lines = 0
  }
  for (const command of commands) {
    if (command.type === 'L') {
      if (lines === (compact ? LINES_PER_OPERATOR : 1)) endLines()
      out.number(Math.round(command.x - x))
      out.number(Math.round(command.y - y))
      lines += 1
    } else if (command.type === 'M') {
      endLines()
      out.number(Math.round(command.x - x))
      out.number(Math.round(command.y - y))
      out.byte(RMOVETO)
    } else if (command.type === 'Q' || command.type === 'C') {
      endLines()
      const cubic = command.type === 'C'
      const x1 = cubic ? command.x1 : Math.round(1 / 3 * x + 2 / 3 * command.x1)
      const y1 = cubic ? command.y1 : Math.round(1 / 3 * y + 2 / 3 * command.y1)
      const x2 = cubic ? command.x2 : Math.round(1 / 3 * command.x + 2 / 3 * command.x1)
      const y2 = cubic ? command.y2 : Math.round(1 / 3 * command.y + 2 / 3 * command.y1)
      out.number(Math.round(x1 - x))
      out.number(Math.round(y1 - y))
      out.number(Math.round(x2 - x1))
      out.number(Math.round(y2 - y1))
      out.number(Math.round(command.x - x2))
      out.number(Math.round(command.y - y2))
      out.byte(RRCURVETO)
    } else {
      continue
    }
    x = Math.round(command.x)
    y = Math.round(command.y)
  }
  endLines()
  out.byte(ENDCHAR)
}
