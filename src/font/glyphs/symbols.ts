import opentype from 'opentype.js';
import { translatePath } from '@/font/geometry/path-ops';
import { appendShape, type NormalizedShape, type Zone } from '@/font/geometry/shape';

const fullCell: Zone = { x: 0, y: 0, width: 1000, height: 1000 };
const tallZone: Zone = { x: 170, y: 80, width: 660, height: 700 };

/** Tall marks (! ? and numerals) share one height and baseline. */
const TALL_MARK_BASELINE = 100;
const TALL_MARK_MAX_WIDTH = 900;

/** The height a symbol is anchored at, and the edge of its ink that sits there. */
function symbolAnchor(char: string): { y: number; edge: 'bottom' | 'top' | 'center' } {
	if (char === '.') return { y: 70, edge: 'bottom' };
	if (char === ',') return { y: 140, edge: 'top' };
	if (char === "'" || char === '"') return { y: 780, edge: 'top' };
	if (char === '_') return { y: 55, edge: 'bottom' };
	if ('+-=*/<>'.includes(char)) return { y: 450, edge: 'center' };
	if ('()[]'.includes(char)) return { y: 80, edge: 'bottom' };
	return { y: TALL_MARK_BASELINE, edge: 'bottom' };
}

/** The height that stays fixed when a symbol is calibrated. */
export function symbolCalibrationAnchor(char: string) {
	return symbolAnchor(char).y;
}

export function symbolMaximumHeight(char: string) {
	if (char === '.' || char === ',') return 140;
	if (char === "'" || char === '"') return 160;
	if ('+-=*/<>'.includes(char)) return 400;
	if ('()[]!?'.includes(char)) return 760;
	return 350;
}

/**
 * Fit a shape so its ink, pen included, is exactly `zone.height` tall. The pen
 * keeps its recorded width, so a plain zone fit misses by the pen difference.
 */
function appendAtInkHeight(path: opentype.Path, shape: NormalizedShape, zone: Zone, penScale: number) {
	const bottomCenter = { x: zone.x + zone.width / 2, y: zone.y };
	let fitted = zone;
	for (let pass = 0; pass < 3; pass += 1) {
		path.commands.length = 0;
		appendShape(path, shape, fitted, false, penScale);
		if (!path.commands.length) return;
		const box = path.getBoundingBox();
		const factor = zone.height / Math.max(1, box.y2 - box.y1);
		if (Math.abs(factor - 1) < 0.001) return;
		const width = fitted.width * factor;
		const height = fitted.height * factor;
		fitted = { x: bottomCenter.x - width / 2, y: bottomCenter.y, width, height };
	}
}

/** A zone of `shape`'s aspect, as tall as the tall-mark zone unless that makes it wider than `maxWidth`. */
function tallMarkZone(shape: NormalizedShape, maxWidth: number, y: number): Zone {
	const height = Math.min(tallZone.height, maxWidth / Math.max(0.01, shape.aspectRatio));
	const width = height * shape.aspectRatio;
	return { x: 500 - width / 2, y, width, height };
}

/** Symbols use optical anchors, independently of letter normalization. */
export function appendSymbol(path: opentype.Path, char: string, shape: NormalizedShape, penScale = 1) {
	if ('!?()[]'.includes(char)) appendAtInkHeight(path, shape, tallMarkZone(shape, tallZone.width, tallZone.y), penScale);
	else appendShape(path, shape, fullCell, true, penScale);
	if (!path.commands.length) return;
	const box = path.getBoundingBox();
	const anchor = symbolAnchor(char);
	const edge = anchor.edge === 'bottom' ? box.y1 : anchor.edge === 'top' ? box.y2 : (box.y1 + box.y2) / 2;
	translatePath(path, 500 - (box.x1 + box.x2) / 2, anchor.y - edge);
}

/**
 * A numeral is fitted by height, like a narrow `!`, so every digit gets the
 * height of `!` and `?` whatever its width; only a very wide digit is capped.
 */
export function appendNumeral(path: opentype.Path, shape: NormalizedShape, penScale = 1) {
	appendAtInkHeight(path, shape, tallMarkZone(shape, TALL_MARK_MAX_WIDTH, TALL_MARK_BASELINE), penScale);
	if (!path.commands.length) return;
	const box = path.getBoundingBox();
	translatePath(path, 500 - (box.x1 + box.x2) / 2, TALL_MARK_BASELINE - box.y1);
}
