import opentype from 'opentype.js'
import { FillRule, union } from 'clipper2-ts'
import { outlinesIntersect } from './ink-collision'

type Point = [number, number]

function contourGroups(path: opentype.Path) {
  const groups: Array<typeof path.commands> = []
  let current: typeof path.commands = []
  for (const command of path.commands) {
    if (command.type === 'M' && current.length) {
      groups.push(current)
      current = []
    }
    current.push(command)
    if (command.type === 'Z') {
      groups.push(current)
      current = []
    }
  }
  if (current.length) groups.push(current)
  return groups
}

function commandBounds(commands: opentype.Path['commands']) {
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity
  for (const command of commands as Array<Record<string, any>>) {
    for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (typeof command[x] !== 'number' || typeof command[y] !== 'number') continue
      x1 = Math.min(x1, command[x]); x2 = Math.max(x2, command[x])
      y1 = Math.min(y1, command[y]); y2 = Math.max(y2, command[y])
    }
  }
  return { x1, y1, x2, y2 }
}

function flatten(commands: opentype.Path['commands']): Point[] {
  const points: Point[] = []
  let current: Point = [0, 0]
  for (const command of commands) {
    if (command.type === 'M' || command.type === 'L') {
      current = [command.x, command.y]
      points.push(current)
    } else if (command.type === 'Q') {
      const start = current
      for (let index = 1; index <= 8; index += 1) {
        const t = index / 8; const s = 1 - t
        current = [s * s * start[0] + 2 * s * t * command.x1 + t * t * command.x,
          s * s * start[1] + 2 * s * t * command.y1 + t * t * command.y]
        points.push(current)
      }
    } else if (command.type === 'C') {
      const start = current
      for (let index = 1; index <= 12; index += 1) {
        const t = index / 12; const s = 1 - t
        current = [s ** 3 * start[0] + 3 * s * s * t * command.x1 + 3 * s * t * t * command.x2 + t ** 3 * command.x,
          s ** 3 * start[1] + 3 * s * s * t * command.y1 + 3 * s * t * t * command.y2 + t ** 3 * command.y]
        points.push(current)
      }
    }
  }
  return points
}

/** CFF CharStrings use even-odd filling, so overlapping ink contours must be merged. */
export function prepareCffPath(path: opentype.Path): opentype.Path {
  const groups = contourGroups(path)
  if (groups.length < 2) return path
  const boxes = groups.map(commandBounds)
  const possibleOverlap = boxes.some((first, index) => boxes.slice(index + 1).some((second) =>
    first.x1 < second.x2 && first.x2 > second.x1 && first.y1 < second.y2 && first.y2 > second.y1))
  if (!possibleOverlap) return path
  const contourPaths = groups.map((commands) => {
    const contour = new opentype.Path()
    contour.commands.push(...commands)
    return contour
  })
  const actualOverlap = contourPaths.some((first, index) => contourPaths.slice(index + 1).some((second) => outlinesIntersect(first, second)))
  if (!actualOverlap) return path

  const precision = 256
  const polygons = groups.map(flatten).filter((points) => points.length >= 3).map((points) =>
    points.map(([x, y]) => ({ x: Math.round(x * precision), y: Math.round(y * precision) })))
  const contours = union(polygons, [], FillRule.NonZero)
  const result = new opentype.Path()
  for (const contour of contours) {
    if (contour.length < 3) continue
    result.moveTo(contour[0].x / precision, contour[0].y / precision)
    for (let index = 1; index < contour.length; index += 1) result.lineTo(contour[index].x / precision, contour[index].y / precision)
    result.close()
  }
  return result
}
