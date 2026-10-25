import opentype from 'opentype.js';
import { describe, expect, test } from 'vitest';
import { prepareCffPath } from '@/font/geometry/cff';
import { hasInkClearance, inkIntersectionArea, maximizeSafeIntrusion } from '@/font/geometry/collision';
import { translatePath } from '@/font/geometry/path-ops';
import { appendShape, combineShapesSideBySide, type NormalizedShape } from '@/font/geometry/shape';
import { outlineStroke } from '@/font/stroke/outline';
import { contourBoxes, penStroke, ring, shapeOf } from './helpers';

function rectangles(...boxes: Array<[number, number, number, number]>) {
	const path = new opentype.Path();
	for (const [x1, y1, x2, y2] of boxes) {
		path.moveTo(x1, y1);
		path.lineTo(x2, y1);
		path.lineTo(x2, y2);
		path.lineTo(x1, y2);
		path.close();
	}
	return path;
}

describe('shapes', () => {
	test('a two-point stroke is outlined in cell space, so it stays a thin line', () => {
		const [stroke] = shapeOf([
			penStroke('line', 35, 75, [
				[0, 0],
				[60, 0]
			])
		]).strokes;
		const xs = stroke.contours[0].map(([x]) => x);
		const ys = stroke.contours[0].map(([, y]) => y);
		const height = Math.max(...ys) - Math.min(...ys);
		expect(height).toBeLessThan(0.07);
		expect((Math.max(...xs) - Math.min(...xs)) / height).toBeGreaterThan(6);
	});

	test('placing a shape at another size moves its centerline but keeps the recorded pen width', () => {
		const shape = shapeOf([
			penStroke('bar', 35, 30, [
				[0, 0],
				[78, 0]
			]),
			penStroke('loop', 74, 72, ring)
		]);
		const large = new opentype.Path();
		const small = new opentype.Path();
		appendShape(large, shape, { x: 100, y: 100, width: 800, height: 800 });
		appendShape(small, shape, { x: 300, y: 300, width: 400, height: 400 });
		// A bar, and a ring with its counter.
		expect(contourBoxes(large)).toHaveLength(3);
		expect(contourBoxes(small)).toHaveLength(3);
		const [largeBar] = contourBoxes(large);
		const [smallBar] = contourBoxes(small);
		const largePen = largeBar.y2 - largeBar.y1;
		const smallPen = smallBar.y2 - smallBar.y1;
		expect(smallPen).toBeCloseTo(largePen, 0);
		// The bar's length without its round caps follows the placement.
		expect((smallBar.x2 - smallBar.x1 - smallPen) / (largeBar.x2 - largeBar.x1 - largePen)).toBeCloseTo(0.5, 1);
	});

	const span = (shape: NormalizedShape, index: number, axis: 0 | 1) => {
		const values = shape.strokes[index].centerline.points.map((point) => point[axis]);
		return Math.max(...values) - Math.min(...values);
	};
	const wide = () =>
		shapeOf([
			penStroke('wide', 20, 60, [
				[0, 0],
				[0, 30],
				[50, 30]
			])
		]);
	const narrow = () =>
		shapeOf([
			penStroke('narrow', 60, 60, [
				[0, 0],
				[20, 30]
			])
		]);

	test('a compound final is its two parts side by side at one height, their widths drawn together and the pen unchanged', () => {
		const compound = combineShapesSideBySide(wide(), narrow());
		expect(compound.synthesized).toBe(true);
		for (const [index, original] of [wide(), narrow()].entries()) {
			expect(span(compound, index, 1)).toBeCloseTo(span(original, 0, 1), 1);
			expect(compound.strokes[index].centerline.diameter).toBe(original.strokes[0].centerline.diameter);
		}
		expect(span(compound, 0, 0)).toBeLessThan(span(wide(), 0, 0));
		expect(span(compound, 1, 0)).toBeGreaterThan(span(narrow(), 0, 0));
		expect(span(compound, 0, 0)).toBeGreaterThan(span(compound, 1, 0));
		const [first, second] = compound.strokes.map((stroke) => stroke.contours.flat().map(([x]) => x));
		expect(Math.min(...second)).toBeGreaterThan(Math.max(...first));
	});

	test('a compound final over its width limit narrows only its wider part, keeping both heights', () => {
		const free = combineShapesSideBySide(wide(), narrow());
		const limited = combineShapesSideBySide(wide(), narrow(), free.aspectRatio * 0.98);
		expect(limited.aspectRatio).toBeCloseTo(free.aspectRatio * 0.98, 9);
		expect(limited.frame.height).toBe(free.frame.height);
		expect(span(limited, 0, 0)).toBeLessThan(span(free, 0, 0));
		expect(span(limited, 0, 1)).toBeCloseTo(span(free, 0, 1), 9);
		expect(span(limited, 1, 0)).toBeCloseTo(span(free, 1, 0), 9);
		expect(span(limited, 1, 1)).toBeCloseTo(span(free, 1, 1), 9);
	});
});

describe('ink collision', () => {
	test('finds how far a protrusion can enter a cavity while keeping its clearance', () => {
		// A bracket open to the right, and a T whose arm points into it.
		const fixed = rectangles([0, 0, 20, 100], [20, 80, 100, 100], [20, 0, 100, 20]);
		const moving = rectangles([143, 45, 223, 55], [203, 0, 223, 100]);
		const intrusion = maximizeSafeIntrusion(fixed, moving, { axis: 'x', direction: -1, clearance: 10, maximum: 120, step: 5 });
		expect(intrusion).toBeGreaterThan(43);
		translatePath(moving, -intrusion, 0);
		expect(inkIntersectionArea(fixed, moving)).toBe(0);
		expect(hasInkClearance(fixed, moving, 9.99)).toBe(true);
		translatePath(moving, -5, 0);
		expect(hasInkClearance(fixed, moving, 9.99)).toBe(false);
	});

	test('CFF outlines merge crossing contours but keep separate curves and counters', () => {
		const cross = rectangles([100, 400, 600, 500], [300, 200, 400, 700]);
		expect(contourBoxes(prepareCffPath(cross))).toHaveLength(1);

		const separate = new opentype.Path();
		separate.moveTo(0, 0);
		separate.quadTo(50, 100, 100, 0);
		separate.close();
		separate.moveTo(200, 0);
		separate.quadTo(250, 100, 300, 0);
		separate.close();
		expect(prepareCffPath(separate).commands.filter((command) => command.type === 'Q')).toHaveLength(2);

		const hollow = new opentype.Path();
		for (const contour of outlineStroke(
			ring,
			ring.map(() => 1),
			10
		).contours) {
			hollow.moveTo(contour[0][0], contour[0][1]);
			for (const [x, y] of contour.slice(1)) hollow.lineTo(x, y);
			hollow.close();
		}
		expect(contourBoxes(prepareCffPath(hollow))).toHaveLength(2);
	});
});
