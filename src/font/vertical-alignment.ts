import opentype from 'opentype.js'

export function translatePath(path: opentype.Path, dx: number, dy: number) {
  for (const command of path.commands as Array<Record<string, any>>) {
    for (const x of ['x', 'x1', 'x2']) if (typeof command[x] === 'number') command[x] += dx
    for (const y of ['y', 'y1', 'y2']) if (typeof command[y] === 'number') command[y] += dy
  }
}

export function alignVerticalCenter(path: opentype.Path, target: number, strength: number) {
  if (!path.commands.length || strength <= 0) return
  const box = path.getBoundingBox()
  const requested = (target - (box.y1 + box.y2) / 2) * Math.max(0, Math.min(1, strength))
  // Keep ink inside the OTF's ascender / descender while preserving baseline classes.
  const shift = Math.max(-150 - box.y1, Math.min(850 - box.y2, requested))
  translatePath(path, 0, shift)
}
