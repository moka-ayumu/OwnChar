/** Converts path commands to an SVG path string. */
export function pathData(commands, digits = 2) {
  const f = (v) => v.toFixed(digits)
  return commands.map((c) => {
    if (c.type === 'M' || c.type === 'L') return `${c.type}${f(c.x)} ${f(c.y)}`
    if (c.type === 'Q') return `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`
    if (c.type === 'C') return `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`
    return 'Z'
  }).join('')
}
