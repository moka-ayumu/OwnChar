import opentype from 'opentype.js';
import { translatePath } from './geometry/path-ops';

export const DEFAULT_HANGUL_HEIGHT = 760;

export function medianHeight(values: number[], fallback: number) {
	const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
	if (!sorted.length) return fallback;
	return sorted[Math.floor(sorted.length / 2)];
}

export function normalizationFactor(height: number, target: number, strength: number, minimum = 0.75) {
	if (height <= 0 || !Number.isFinite(height)) return 1;
	const bounded = Math.max(minimum, Math.min(1.25, target / height));
	return 1 + Math.max(0, Math.min(1, strength)) * (bounded - 1);
}

export function alignVerticalCenter(path: opentype.Path, target: number, strength: number) {
	if (!path.commands.length || strength <= 0) return;
	const box = path.getBoundingBox();
	const requested = (target - (box.y1 + box.y2) / 2) * Math.max(0, Math.min(1, strength));
	// Keep ink inside the OTF's ascender / descender while preserving baseline classes.
	const shift = Math.max(-150 - box.y1, Math.min(850 - box.y2, requested));
	translatePath(path, 0, shift);
}
