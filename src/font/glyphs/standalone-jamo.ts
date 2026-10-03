import opentype from 'opentype.js'
import { centerX, centerY, scalePath } from '@/font/geometry/path-ops'
import { appendShape, scaleZone, type NormalizedShape, type Zone } from '@/font/geometry/shape'
import { alignVerticalCenter, normalizationFactor } from '@/font/metrics'
import type { CompositionSettings } from '@/font/settings'

/** Where a jamo written on its own is first fitted. */
const JAMO_ZONE: Zone = { x: 100, y: 80, width: 800, height: 760 }

/** Ink size and centre a standalone jamo is measured against: those of 가. */
export interface ReferenceEnvelope {
  width: number
  height: number
  centerX: number
  centerY: number
}

export function composeStandaloneJamoPath(shape: NormalizedShape, settings: CompositionSettings, reference: ReferenceEnvelope, penScale = 1) {
  const path = new opentype.Path()
  let zoneFactor = 1
  const appendAt = (factor: number, pen = penScale) => {
    zoneFactor = factor
    path.commands.length = 0
    appendShape(path, shape, scaleZone(JAMO_ZONE, factor), false, pen)
  }
  appendAt(1)
  let box = path.getBoundingBox()
  const normalizedFactor = normalizationFactor(box.y2 - box.y1, reference.height, settings.jamoNormalization, 0.6)
  if (Math.abs(normalizedFactor - 1) > 0.005) appendAt(normalizedFactor)

  const ratio = Math.max(0.1, Math.min(1, settings.standaloneJamoMaxHeight))
  const fitFor = (current: opentype.BoundingBox) => Math.min(
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
  scalePath(path, fit, { x: centerX(box), y: centerY(box) }, { x: reference.centerX, y: centerY(box) })
  alignVerticalCenter(path, reference.centerY, settings.verticalAlignment)
  return path
}
