import opentype from 'opentype.js'
import { appendShape, type NormalizedShape, type Zone } from './path-geometry'
import { translatePath } from './vertical-alignment'

const fullCell: Zone = { x: 0, y: 0, width: 1000, height: 1000 }
const tallZone: Zone = { x: 170, y: 80, width: 660, height: 700 }

/** Symbols use optical anchors, independently of letter normalization. */
export function appendSymbol(path: opentype.Path, char: string, shape: NormalizedShape) {
  const tall = '!?()[]'.includes(char)
  appendShape(path, shape, tall ? tallZone : fullCell, !tall)
  if (!path.commands.length) return
  const box = path.getBoundingBox()
  const centerX = (box.x1 + box.x2) / 2
  const dy = char === '.' ? 70 - box.y1
    : char === ',' ? 140 - box.y2
      : char === '\'' || char === '"' ? 780 - box.y2
        : char === '_' ? 55 - box.y1
          : '+-=*/<>'.includes(char) ? 450 - (box.y1 + box.y2) / 2
            : '()[]'.includes(char) ? 80 - box.y1 : 100 - box.y1
  translatePath(path, 500 - centerX, dy)
}
