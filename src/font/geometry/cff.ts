import opentype from 'opentype.js'
import { FillRule, union } from 'clipper2-ts'
import { outlinesIntersect } from './collision'
import { controlPoints, flattenContours, pointsBox, splitContours } from './path-ops'

/** CFF CharStrings use even-odd filling, so overlapping ink contours must be merged. */
export function prepareCffPath(path: opentype.Path): opentype.Path {
  const contours = splitContours(path)
  if (contours.length < 2) return path
  const boxes = contours.map((contour) => pointsBox(controlPoints(contour.commands)))
  const possibleOverlap = boxes.some((first, index) => boxes.slice(index + 1).some((second) =>
    first.x1 < second.x2 && first.x2 > second.x1 && first.y1 < second.y2 && first.y2 > second.y1))
  if (!possibleOverlap) return path
  const actualOverlap = contours.some((first, index) => contours.slice(index + 1).some((second) => outlinesIntersect(first, second)))
  if (!actualOverlap) return path

  const precision = 256
  const polygons = flattenContours(path, () => 8, () => 12).map((points) =>
    points.map(([x, y]) => ({ x: Math.round(x * precision), y: Math.round(y * precision) })))
  const result = new opentype.Path()
  for (const contour of union(polygons, [], FillRule.NonZero)) {
    if (contour.length < 3) continue
    result.moveTo(contour[0].x / precision, contour[0].y / precision)
    for (let index = 1; index < contour.length; index += 1) result.lineTo(contour[index].x / precision, contour[index].y / precision)
    result.close()
  }
  return result
}
