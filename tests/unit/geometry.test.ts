import opentype from 'opentype.js'
import { describe, expect, test } from 'vitest'
import { prepareCffPath } from '@/font/geometry/cff'
import { hasInkClearance, inkIntersectionArea, maximizeSafeIntrusion } from '@/font/geometry/collision'
import { translatePath } from '@/font/geometry/path-ops'
import { appendShape, combineShapesSideBySide } from '@/font/geometry/shape'
import { outlineStroke } from '@/font/stroke/outline'
import { contourBoxes, penStroke, ring, shapeOf } from './helpers'

function rectangles(...boxes: Array<[number, number, number, number]>) {
  const path = new opentype.Path()
  for (const [x1, y1, x2, y2] of boxes) {
    path.moveTo(x1, y1); path.lineTo(x2, y1); path.lineTo(x2, y2); path.lineTo(x1, y2); path.close()
  }
  return path
}

describe('shapes', () => {
  test('a two-point stroke is outlined in cell space, so it stays a thin line', () => {
    const [stroke] = shapeOf([penStroke('line', 35, 75, [[0, 0], [60, 0]])]).strokes
    const xs = stroke.contours[0].map(([x]) => x)
    const ys = stroke.contours[0].map(([, y]) => y)
    const height = Math.max(...ys) - Math.min(...ys)
    expect(height).toBeLessThan(0.07)
    expect((Math.max(...xs) - Math.min(...xs)) / height).toBeGreaterThan(6)
  })

  test('placing a shape at another size moves its centerline but keeps the recorded pen width', () => {
    const shape = shapeOf([penStroke('bar', 35, 30, [[0, 0], [78, 0]]), penStroke('loop', 74, 72, ring)])
    const large = new opentype.Path()
    const small = new opentype.Path()
    appendShape(large, shape, { x: 100, y: 100, width: 800, height: 800 })
    appendShape(small, shape, { x: 300, y: 300, width: 400, height: 400 })
    // A bar, and a ring with its counter.
    expect(contourBoxes(large)).toHaveLength(3)
    expect(contourBoxes(small)).toHaveLength(3)
    const [largeBar] = contourBoxes(large)
    const [smallBar] = contourBoxes(small)
    const largePen = largeBar.y2 - largeBar.y1
    const smallPen = smallBar.y2 - smallBar.y1
    expect(smallPen).toBeCloseTo(largePen, 0)
    // The bar's length without its round caps follows the placement.
    expect((smallBar.x2 - smallBar.x1 - smallPen) / (largeBar.x2 - largeBar.x1 - largePen)).toBeCloseTo(0.5, 1)
  })

  test('a compound final is its two parts side by side, each scaled uniformly with its pen unchanged', () => {
    const left = shapeOf([penStroke('left', 40, 20, [[0, 0], [20, 40]])])
    const right = shapeOf([penStroke('right', 40, 20, [[20, 0], [0, 60]])])
    const compound = combineShapesSideBySide(left, right)
    expect(compound.synthesized).toBe(true)
    for (const [index, original] of [left, right].entries()) {
      const before = original.strokes[0].centerline.points
      const after = compound.strokes[index].centerline.points
      const sx = (after[1][0] - after[0][0]) / (before[1][0] - before[0][0])
      const sy = (after[1][1] - after[0][1]) / (before[1][1] - before[0][1])
      expect(sx).toBeCloseTo(sy, 9)
      expect(compound.strokes[index].centerline.diameter).toBe(original.strokes[0].centerline.diameter)
    }
    const [first, second] = compound.strokes.map((stroke) => stroke.contours.flat().map(([x]) => x))
    expect(Math.min(...second)).toBeGreaterThan(Math.max(...first))
  })
})

describe('ink collision', () => {
  test('finds how far a protrusion can enter a cavity while keeping its clearance', () => {
    // A bracket open to the right, and a T whose arm points into it.
    const fixed = rectangles([0, 0, 20, 100], [20, 80, 100, 100], [20, 0, 100, 20])
    const moving = rectangles([143, 45, 223, 55], [203, 0, 223, 100])
    const intrusion = maximizeSafeIntrusion(fixed, moving, { axis: 'x', direction: -1, clearance: 10, maximum: 120, step: 5 })
    expect(intrusion).toBeGreaterThan(43)
    translatePath(moving, -intrusion, 0)
    expect(inkIntersectionArea(fixed, moving)).toBe(0)
    expect(hasInkClearance(fixed, moving, 9.99)).toBe(true)
    translatePath(moving, -5, 0)
    expect(hasInkClearance(fixed, moving, 9.99)).toBe(false)
  })

  test('CFF outlines merge crossing contours but keep separate curves and counters', () => {
    const cross = rectangles([100, 400, 600, 500], [300, 200, 400, 700])
    expect(contourBoxes(prepareCffPath(cross))).toHaveLength(1)

    const separate = new opentype.Path()
    separate.moveTo(0, 0); separate.quadTo(50, 100, 100, 0); separate.close()
    separate.moveTo(200, 0); separate.quadTo(250, 100, 300, 0); separate.close()
    expect(prepareCffPath(separate).commands.filter((command) => command.type === 'Q')).toHaveLength(2)

    const hollow = new opentype.Path()
    for (const contour of outlineStroke(ring, ring.map(() => 1), 10).contours) {
      hollow.moveTo(contour[0][0], contour[0][1])
      for (const [x, y] of contour.slice(1)) hollow.lineTo(x, y)
      hollow.close()
    }
    expect(contourBoxes(prepareCffPath(hollow))).toHaveLength(2)
  })
})
