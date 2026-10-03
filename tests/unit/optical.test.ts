import { describe, expect, test } from 'vitest'
import { inkBalance } from '@/font/geometry/optical'
import { CELL, penStroke, shapeOf } from './helpers'

describe('ink balance', () => {
  test('a symmetric jamo is balanced on the middle of its pen paths', () => {
    const mieum = shapeOf([penStroke('m', 30, 40, [[0, 0], [60, 0], [60, 60], [0, 60], [0, 0]])])
    expect(inkBalance(mieum).mean).toBeCloseTo(0, 6)
    expect(inkBalance(mieum).core).toBeCloseTo(0, 2)
    expect(inkBalance(mieum).length).toBeCloseTo(240 / CELL, 6)
  })

  test('ink gathered on one side draws the balance there', () => {
    const giyeok = shapeOf([penStroke('g', 30, 40, [[0, 0], [60, 0], [60, 60]])])
    // Half the ink lies on the right edge, the other half is spread over the bar.
    expect(inkBalance(giyeok).mean).toBeCloseTo(15 / CELL, 6)
    expect(inkBalance(giyeok).core).toBeGreaterThan(0)
  })

  test('a thin protrusion moves the mean but hardly the core', () => {
    const body = (tick: number) => shapeOf([
      penStroke('b1', 40, 40, [[0, 0], [0, 50]]), penStroke('b2', 90, 40, [[0, 0], [0, 50]]),
      penStroke('b3', 40, 65, [[0, 0], [50 + tick, 0]]), penStroke('b4', 40, 90, [[0, 0], [50, 0]]),
    ])
    // Offsets are from the middle of the pen paths, which the 20px tick moves 10px right.
    const ticked = inkBalance(body(20))
    expect(ticked.core * CELL + 10).toBeLessThan(2)
    expect(ticked.core * CELL + 10).toBeGreaterThan(-2)
    expect(ticked.mean * CELL + 10).toBeGreaterThan(3)
  })

  test('a shape without a pen path has no offset', () => {
    const dot = shapeOf([penStroke('d', 70, 70, [[0, 0]])])
    expect(inkBalance(dot)).toMatchObject({ mean: 0, core: 0 })
  })
})
