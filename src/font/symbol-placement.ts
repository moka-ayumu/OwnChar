import opentype from 'opentype.js'
import { appendShape, type NormalizedShape, type Zone } from './path-geometry'
import { translatePath } from './vertical-alignment'

const fullCell: Zone = { x: 0, y: 0, width: 1000, height: 1000 }
const tallZone: Zone = { x: 170, y: 80, width: 660, height: 700 }

/** Tall marks (! ? and numerals) share one height and baseline. */
export const TALL_MARK_BASELINE = 100
export const TALL_MARK_MAX_WIDTH = 900

/**
 * Fit a shape so its ink, pen included, is exactly `zone.height` tall. The pen
 * keeps its recorded width, so a plain zone fit misses by the pen difference.
 */
function appendAtInkHeight(path: opentype.Path, shape: NormalizedShape, zone: Zone, penScale: number) {
  const bottomCenter = { x: zone.x + zone.width / 2, y: zone.y }
  let fitted = zone
  for (let pass = 0; pass < 3; pass += 1) {
    path.commands.length = 0
    appendShape(path, shape, fitted, false, penScale)
    if (!path.commands.length) return
    const box = path.getBoundingBox()
    const factor = zone.height / Math.max(1, box.y2 - box.y1)
    if (Math.abs(factor - 1) < 0.001) return
    const width = fitted.width * factor
    const height = fitted.height * factor
    fitted = { x: bottomCenter.x - width / 2, y: bottomCenter.y, width, height }
  }
}

/** Symbols use optical anchors, independently of letter normalization. */
export function appendSymbol(path: opentype.Path, char: string, shape: NormalizedShape, penScale = 1) {
  const tall = '!?()[]'.includes(char)
  if (tall) {
    const height = Math.min(tallZone.height, tallZone.width / Math.max(0.01, shape.aspectRatio))
    const width = height * shape.aspectRatio
    appendAtInkHeight(path, shape, { x: 500 - width / 2, y: tallZone.y, width, height }, penScale)
  } else appendShape(path, shape, fullCell, true, penScale)
  if (!path.commands.length) return
  const box = path.getBoundingBox()
  const centerX = (box.x1 + box.x2) / 2
  const dy = char === '.' ? 70 - box.y1
    : char === ',' ? 140 - box.y2
      : char === '\'' || char === '"' ? 780 - box.y2
        : char === '_' ? 55 - box.y1
          : '+-=*/<>'.includes(char) ? 450 - (box.y1 + box.y2) / 2
            : '()[]'.includes(char) ? 80 - box.y1 : TALL_MARK_BASELINE - box.y1
  translatePath(path, 500 - centerX, dy)
}

/**
 * A numeral is fitted by height, like a narrow `!`, so every digit gets the
 * height of `!` and `?` whatever its width; only a very wide digit is capped.
 */
export function appendNumeral(path: opentype.Path, shape: NormalizedShape, penScale = 1) {
  const height = Math.min(tallZone.height, TALL_MARK_MAX_WIDTH / Math.max(0.01, shape.aspectRatio))
  const width = height * shape.aspectRatio
  appendAtInkHeight(path, shape, { x: 500 - width / 2, y: TALL_MARK_BASELINE, width, height }, penScale)
  if (!path.commands.length) return
  const box = path.getBoundingBox()
  translatePath(path, 500 - (box.x1 + box.x2) / 2, TALL_MARK_BASELINE - box.y1)
}
