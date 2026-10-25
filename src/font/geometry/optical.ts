import type { NormalizedShape } from './shape';

/** Where the ink of a shape sits across its width, measured along its pen paths. */
export interface InkBalance {
	/** Offset of the mean ink position from the middle of the pen paths' extent, in cell fractions. */
	mean: number;
	/** The same for the middle of the span holding the central 80% of the ink: a thin protrusion does not widen it. */
	core: number;
	/** Width of that span, in cell fractions. */
	span: number;
	/** Total length of the pen paths, in cell fractions. */
	length: number;
}

const BINS = 64;
/** Widest a row may be, in shape widths, to count as part of a thin protrusion. */
const THIN_ROW = 0.35;
/** Longest protrusion cut in full, and the length from which none is cut, in shape heights. */
const THIN_FULL = 0.25;
const THIN_NONE = 0.35;
const balances = new WeakMap<NormalizedShape, InkBalance>();
const anchors = new WeakMap<NormalizedShape, number>();

/**
 * Horizontal ink balance of a shape. Ink is counted as pen-path length times
 * pen width, so overlapping strokes are not merged and nothing is rasterized.
 * Offsets scale with the shape and do not change when it is moved.
 */
export function inkBalance(shape: NormalizedShape): InkBalance {
	const cached = balances.get(shape);
	if (cached) return cached;
	// [from, to, weight, length] of every pen-path segment, in cell fractions.
	const segments: Array<[number, number, number, number]> = [];
	for (const { centerline } of shape.strokes) {
		const { points, diameter, cellSize } = centerline;
		const pen = diameter / cellSize;
		// A dot is as long as the pen is wide.
		if (points.length === 1) segments.push([points[0][0] / cellSize, points[0][0] / cellSize, pen * pen, pen]);
		for (let index = 1; index < points.length; index += 1) {
			const length = Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]) / cellSize;
			if (length > 0) segments.push([points[index - 1][0] / cellSize, points[index][0] / cellSize, length * pen, length]);
		}
	}
	const total = segments.reduce((sum, segment) => sum + segment[2], 0);
	const length = segments.reduce((sum, segment) => sum + segment[3], 0);
	const left = Math.min(...segments.flatMap(([from, to]) => [from, to]));
	const width = Math.max(...segments.flatMap(([from, to]) => [from, to])) - left;
	let balance: InkBalance = { mean: 0, core: 0, span: 0, length };
	if (total > 0 && width > 0) {
		const mean = segments.reduce((sum, [from, to, weight]) => sum + ((from + to) / 2) * weight, 0) / total;
		// Each segment spreads its ink evenly over the columns it crosses.
		const columns = new Array<number>(BINS).fill(0);
		const column = (x: number) => Math.min(BINS - 1, Math.floor(((x - left) / width) * BINS));
		for (const [from, to, weight] of segments) {
			const first = column(Math.min(from, to));
			const last = column(Math.max(from, to));
			for (let index = first; index <= last; index += 1) columns[index] += weight / (last - first + 1);
		}
		const quantile = (share: number) => {
			let passed = 0;
			let index = 0;
			while (index < BINS - 1 && passed + columns[index] < total * share) {
				passed += columns[index];
				index += 1;
			}
			return left + ((index + (columns[index] > 0 ? (total * share - passed) / columns[index] : 0.5)) * width) / BINS;
		};
		balance = { mean: mean - (left + width / 2), core: (quantile(0.1) + quantile(0.9)) / 2 - (left + width / 2), span: quantile(0.9) - quantile(0.1), length };
	}
	balances.set(shape, balance);
	return balance;
}

/**
 * Offset of the vertical middle of a shape's body from the middle of its pen
 * paths' extent, in cell fractions, positive downward. A thin protrusion at
 * either end, such as the tick of ㅎ, is not part of the body.
 */
export function verticalAnchor(shape: NormalizedShape): number {
	const cached = anchors.get(shape);
	if (cached !== undefined) return cached;
	const segments: Array<[number, number, number, number]> = [];
	for (const { centerline } of shape.strokes) {
		const { points, cellSize } = centerline;
		if (points.length === 1) segments.push([points[0][0] / cellSize, points[0][1] / cellSize, points[0][0] / cellSize, points[0][1] / cellSize]);
		for (let index = 1; index < points.length; index += 1) {
			segments.push([points[index - 1][0] / cellSize, points[index - 1][1] / cellSize, points[index][0] / cellSize, points[index][1] / cellSize]);
		}
	}
	const ys = segments.flatMap(([, y0, , y1]) => [y0, y1]);
	const xs = segments.flatMap(([x0, , x1]) => [x0, x1]);
	const top = Math.min(...ys);
	const height = Math.max(...ys) - top;
	const width = Math.max(...xs) - Math.min(...xs);
	let anchor = 0;
	if (height > 0 && width > 0) {
		// The horizontal extent of the ink in each row.
		const left = new Array<number>(BINS).fill(Infinity);
		const right = new Array<number>(BINS).fill(-Infinity);
		const row = (y: number) => Math.min(BINS - 1, Math.floor(((y - top) / height) * BINS));
		for (const [x0, y0, x1, y1] of segments) {
			const first = row(Math.min(y0, y1));
			const last = row(Math.max(y0, y1));
			for (let index = first; index <= last; index += 1) {
				const from = Math.max(top + (index / BINS) * height, Math.min(y0, y1));
				const to = Math.min(top + ((index + 1) / BINS) * height, Math.max(y0, y1));
				for (const y of [from, to]) {
					const x = y1 === y0 ? x0 : x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
					left[index] = Math.min(left[index], x, y1 === y0 ? x1 : x);
					right[index] = Math.max(right[index], x, y1 === y0 ? x1 : x);
				}
			}
		}
		const thin = (index: number) => right[index] - left[index] < width * THIN_ROW;
		/** Rows of the protrusion that starts at `from`, weighed down to nothing as it grows long. */
		const cut = (from: number, step: 1 | -1) => {
			let rows = 0;
			while (rows < BINS && thin(from + step * rows)) rows += 1;
			const share = (THIN_NONE - rows / BINS) / (THIN_NONE - THIN_FULL);
			return rows * Math.max(0, Math.min(1, share));
		};
		anchor = (cut(0, 1) - cut(BINS - 1, -1)) / 2 / BINS;
	}
	anchors.set(shape, anchor * height);
	return anchor * height;
}
