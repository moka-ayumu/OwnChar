import opentype from 'opentype.js'

export type Point = [number, number]

/** An axis-aligned box in font units (y up). */
export interface Box { x1: number; y1: number; x2: number; y2: number }

type Commands = opentype.Path['commands']

const COORDINATE_PAIRS = [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']] as const

/** Replaces every on- and off-curve point of `commands` in place. */
export function mapPoints(commands: Commands, map: (x: number, y: number) => readonly [number, number]) {
  for (const command of commands as Array<Record<string, any>>) {
    for (const [xKey, yKey] of COORDINATE_PAIRS) {
      if (typeof command[xKey] !== 'number' || typeof command[yKey] !== 'number') continue
      const [x, y] = map(command[xKey], command[yKey])
      command[xKey] = x
      command[yKey] = y
    }
  }
}

/** Every on- and off-curve point of `commands`. */
export function controlPoints(commands: Commands): Point[] {
  const points: Point[] = []
  for (const command of commands as Array<Record<string, any>>) {
    for (const [xKey, yKey] of COORDINATE_PAIRS) {
      if (typeof command[xKey] === 'number' && typeof command[yKey] === 'number') points.push([command[xKey], command[yKey]])
    }
  }
  return points
}

export function translatePath(path: opentype.Path, dx: number, dy: number) {
  mapPoints(path.commands, (x, y) => [x + dx, y + dy])
}

/** Scales `path` so that `from` lands on `to` (by default it stays in place). */
export function scalePath(path: opentype.Path, scale: number, from: { x: number; y: number }, to = from) {
  mapPoints(path.commands, (x, y) => [to.x + (x - from.x) * scale, to.y + (y - from.y) * scale])
}

export function pathOf(commands: Commands) {
  const path = new opentype.Path()
  path.commands.push(...commands)
  return path
}

export function pathBounds(path: opentype.Path): Box | undefined {
  return path.commands.length ? path.getBoundingBox() : undefined
}

/** One path per contour; a contour starts at each move command. */
export function splitContours(path: opentype.Path): opentype.Path[] {
  const contours: opentype.Path[] = []
  for (const command of path.commands) {
    if (command.type === 'M') contours.push(new opentype.Path())
    contours.at(-1)?.commands.push(command)
  }
  return contours
}

export const centerX = (box: Box) => (box.x1 + box.x2) / 2
export const centerY = (box: Box) => (box.y1 + box.y2) / 2
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function unionBox(boxes: Box[]): Box {
  return {
    x1: Math.min(...boxes.map((box) => box.x1)),
    y1: Math.min(...boxes.map((box) => box.y1)),
    x2: Math.max(...boxes.map((box) => box.x2)),
    y2: Math.max(...boxes.map((box) => box.y2)),
  }
}

export function pointsBox(points: ReadonlyArray<readonly [number, number]>): Box {
  return {
    x1: Math.min(...points.map(([x]) => x)),
    y1: Math.min(...points.map(([, y]) => y)),
    x2: Math.max(...points.map(([x]) => x)),
    y2: Math.max(...points.map(([, y]) => y)),
  }
}

/**
 * Closed polylines of a path. `quadSteps` and `cubicSteps` choose how many
 * segments a curve gets from the length of its control polygon. Contours with
 * fewer than three points enclose nothing and are dropped.
 */
export function flattenContours(path: opentype.Path, quadSteps: (length: number) => number, cubicSteps: (length: number) => number): Point[][] {
  const contours: Point[][] = []
  let contour: Point[] = []
  let current: Point = [0, 0]
  const add = (point: Point) => { contour.push(point); current = point }
  const finish = () => {
    if (contour.length > 2) contours.push(contour)
    contour = []
  }
  for (const command of path.commands) {
    if (command.type === 'M') {
      finish()
      add([command.x, command.y])
    } else if (command.type === 'L') {
      add([command.x, command.y])
    } else if (command.type === 'Q') {
      const start = current
      const steps = quadSteps(Math.hypot(command.x1 - start[0], command.y1 - start[1]) + Math.hypot(command.x - command.x1, command.y - command.y1))
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps
        const s = 1 - t
        add([s * s * start[0] + 2 * s * t * command.x1 + t * t * command.x,
          s * s * start[1] + 2 * s * t * command.y1 + t * t * command.y])
      }
    } else if (command.type === 'C') {
      const start = current
      const steps = cubicSteps(Math.hypot(command.x1 - start[0], command.y1 - start[1]) + Math.hypot(command.x2 - command.x1, command.y2 - command.y1) + Math.hypot(command.x - command.x2, command.y - command.y2))
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps
        const s = 1 - t
        add([s ** 3 * start[0] + 3 * s * s * t * command.x1 + 3 * s * t * t * command.x2 + t ** 3 * command.x,
          s ** 3 * start[1] + 3 * s * s * t * command.y1 + 3 * s * t * t * command.y2 + t ** 3 * command.y])
      }
    } else if (command.type === 'Z') {
      finish()
    }
  }
  finish()
  return contours
}
