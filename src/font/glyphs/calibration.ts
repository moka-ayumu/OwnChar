import opentype from 'opentype.js';
import { isHangulSyllable } from '@/font/hangul';
import { scalePath, translatePath } from '@/font/geometry/path-ops';
import type { NormalizedShape } from '@/font/geometry/shape';
import { composeHangulPath, type HangulComposeOptions } from '@/font/layout/compose-syllable';
import type { GapProfile } from '@/font/layout/gap-profile';
import { medianHeight } from '@/font/metrics';
import { DEFAULT_COMPOSITION_SETTINGS, type CompositionSettings } from '@/font/settings';

export const VISUAL_HANGUL_HEIGHT = 800;

/** The lowest ink of a glyph, which is also the descender of the font. */
export const DESCENDER_LIMIT = -250;

const fallbackSyllables = ['가', '나', '다', '마', '바', '사', '세', '루', '요'];

/** One project-level scale keeps the relative proportions of handwriting samples. */
export function visualCalibrationScale(shapes: Map<string, NormalizedShape>, settings: CompositionSettings, options: HangulComposeOptions & { gaps: GapProfile; targetHeight: number }) {
	const samples = Object.keys(options.gaps.initialMedialSyllables);
	const characters = samples.length ? samples.slice(0, 48) : fallbackSyllables;
	const referenceSettings = { ...settings, hangulNormalization: DEFAULT_COMPOSITION_SETTINGS.hangulNormalization };
	const heights = characters
		.map((char) => {
			const codePoint = char.codePointAt(0)!;
			if (!isHangulSyllable(codePoint)) return 0;
			const path = composeHangulPath(codePoint, shapes, referenceSettings, options);
			if (!path.commands.length) return 0;
			const box = path.getBoundingBox();
			return box.y2 - box.y1;
		})
		.filter((height) => height >= 200 && height <= 950);
	const observed = medianHeight(heights, options.targetHeight);
	return Math.max(0.85, Math.min(1.6, VISUAL_HANGUL_HEIGHT / observed));
}

/** The scale `calibrateGlyphPath` applies: `factor` unless the glyph would outgrow its limits. */
function calibrationFactor(path: opentype.Path, factor: number, fixedWidth: boolean, maximumHeight: number) {
	if (!path.commands.length) return factor;
	const box = path.getBoundingBox();
	const height = box.y2 - box.y1;
	const width = box.x2 - box.x1;
	return Math.min(factor, maximumHeight / Math.max(1, height), (fixedWidth ? 900 : 950) / Math.max(1, width));
}

/** Scale the whole ink outline, preserving its stroke-to-letter ratio. */
function calibrateGlyphPath(path: opentype.Path, factor: number, anchorY: number, targetAnchorY: number, fixedWidth: boolean, maximumHeight: number) {
	if (!path.commands.length) return;
	scalePath(path, calibrationFactor(path, factor, fixedWidth, maximumHeight), { x: 500, y: anchorY }, { x: 500, y: targetAnchorY });
	const adjusted = path.getBoundingBox();
	const dx = fixedWidth ? 500 - (adjusted.x1 + adjusted.x2) / 2 : 0;
	const dy = adjusted.y1 < DESCENDER_LIMIT ? DESCENDER_LIMIT - adjusted.y1 : adjusted.y2 > 900 ? 900 - adjusted.y2 : 0;
	if (dx || dy) translatePath(path, dx, dy);
}

/**
 * Render a glyph whose pen is rebuilt at `penScale`, then calibrate it. When a
 * height or width limit reduces the calibration below `factor`, the glyph is
 * rendered again with a wider pen so every glyph ends with the same stroke.
 */
export function renderCalibratedGlyph(render: (penScale: number) => opentype.Path, factor: number, anchorY: number, targetAnchorY: number, fixedWidth: boolean, maximumHeight = 950) {
	let path = render(1);
	const safe = calibrationFactor(path, factor, fixedWidth, maximumHeight);
	if (path.commands.length && safe > 0 && Math.abs(factor / safe - 1) > 0.005) path = render(factor / safe);
	calibrateGlyphPath(path, factor, anchorY, targetAnchorY, fixedWidth, maximumHeight);
	return path;
}
