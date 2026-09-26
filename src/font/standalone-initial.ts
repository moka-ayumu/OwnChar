import opentype from 'opentype.js'
import type { CompositionSettings } from '@/types/project'
import { appendShape, type NormalizedShape, type Zone } from './path-geometry'
import { normalizationFactor } from './size-normalization'
import { alignVerticalCenter } from './vertical-alignment'

const initialZone: Zone = { x: 100, y: 80, width: 800, height: 760 }

function scaledZone(factor: number): Zone {
  return {
    x: initialZone.x + initialZone.width * (1 - factor) / 2,
    y: initialZone.y + initialZone.height * (1 - factor) / 2,
    width: initialZone.width * factor,
    height: initialZone.height * factor,
  }
}

export interface ReferenceEnvelope {
  width: number
  height: number
  centerX: number
  centerY: number
}

function scalePath(path: opentype.Path, scale: number, targetX: number, targetY: number) {
  const box = path.getBoundingBox()
  const sourceX = (box.x1 + box.x2) / 2
  const sourceY = (box.y1 + box.y2) / 2
  for (const command of path.commands as Array<Record<string, any>>) {
    for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) {
      if (typeof command[x] === 'number') command[x] = targetX + (command[x] - sourceX) * scale
      if (typeof command[y] === 'number') command[y] = targetY + (command[y] - sourceY) * scale
    }
  }
}

export function composeStandaloneJamoPath(shape: NormalizedShape, settings: CompositionSettings, reference: ReferenceEnvelope, penScale = 1) {
  const path = new opentype.Path()
  let zoneFactor = 1
  const appendAt = (factor: number, pen = penScale) => {
    zoneFactor = factor
    path.commands.length = 0
    appendShape(path, shape, scaledZone(factor), false, pen)
  }
  appendAt(1)
  let box = path.getBoundingBox()
  const initialHeight = box.y2 - box.y1
  const normalizedFactor = normalizationFactor(initialHeight, reference.height, settings.jamoNormalization, 0.6)
  if (Math.abs(normalizedFactor - 1) > 0.005) appendAt(normalizedFactor)

  const ratio = Math.max(0.1, Math.min(1, settings.standaloneJamoMaxHeight))
  const fitFor = (current: ReturnType<opentype.Path['getBoundingBox']>) => Math.min(
    1,
    reference.width * ratio / Math.max(1, current.x2 - current.x1),
    reference.height * ratio / Math.max(1, current.y2 - current.y1),
  )
  box = path.getBoundingBox()
  let fit = fitFor(box)
  // The fit scales the outline itself, so the pen is first widened by 1/fit to
  // end unchanged. That widening grows the ink, so settle the fit on it.
  if (fit < 0.995) {
    let rendered = 1
    for (let pass = 0; pass < 4; pass += 1) {
      appendAt(zoneFactor, penScale / fit)
      rendered = fit
      box = path.getBoundingBox()
      const next = fitFor(box)
      if (Math.abs(next / fit - 1) < 0.001) break
      fit = next
    }
    // Scale the outline that was rendered, never beyond the reference.
    fit = Math.min(rendered, fitFor(box))
  }
  scalePath(path, fit, reference.centerX, (box.y1 + box.y2) / 2)
  alignVerticalCenter(path, reference.centerY, settings.verticalAlignment)
  return path
}
