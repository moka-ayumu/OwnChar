/**
 * SVG path data for outline commands in font coordinates (no y flip).
 * opentype.js `toPathData` optimizes repeated coordinates and can emit `NaN`,
 * which truncates the drawing, so display code serializes commands itself.
 */
export function svgPathData(commands: ReadonlyArray<{ type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }>, digits = 2) {
  const f = (value: number | undefined) => String(Math.round((value ?? 0) * 10 ** digits) / 10 ** digits)
  return commands.map((command) => {
    if (command.type === 'M' || command.type === 'L') return `${command.type}${f(command.x)} ${f(command.y)}`
    if (command.type === 'Q') return `Q${f(command.x1)} ${f(command.y1)} ${f(command.x)} ${f(command.y)}`
    if (command.type === 'C') return `C${f(command.x1)} ${f(command.y1)} ${f(command.x2)} ${f(command.y2)} ${f(command.x)} ${f(command.y)}`
    return 'Z'
  }).join('')
}
