import opentype from 'opentype.js';
import { FillRule, union } from 'clipper2-ts';
import { contoursIntersect, flattenOutline } from './collision';
import { controlPoints, flattenContours, pointsBox, splitContours, type Point } from './path-ops';

/** CFF CharStrings use even-odd filling, so overlapping ink contours must be merged. */
export function prepareCffPath(path: opentype.Path): opentype.Path {
	const contours = splitContours(path);
	if (contours.length < 2) return path;
	const boxes = contours.map((contour) => pointsBox(controlPoints(contour.commands)));
	// Contours whose boxes are apart cannot touch; the others are flattened once, when first compared.
	const flattened: Point[][][] = [];
	const flat = (index: number) => (flattened[index] ??= flattenOutline(contours[index]));
	const actualOverlap = boxes.some((first, index) =>
		boxes.some((second, other) => other > index && first.x1 < second.x2 && first.x2 > second.x1 && first.y1 < second.y2 && first.y2 > second.y1 && contoursIntersect(flat(index), flat(other)))
	);
	if (!actualOverlap) return path;

	const precision = 256;
	const polygons = flattenContours(
		path,
		() => 8,
		() => 12
	).map((points) => points.map(([x, y]) => ({ x: Math.round(x * precision), y: Math.round(y * precision) })));
	const result = new opentype.Path();
	for (const contour of union(polygons, [], FillRule.NonZero)) {
		if (contour.length < 3) continue;
		result.moveTo(contour[0].x / precision, contour[0].y / precision);
		for (let index = 1; index < contour.length; index += 1) result.lineTo(contour[index].x / precision, contour[index].y / precision);
		result.close();
	}
	return result;
}
