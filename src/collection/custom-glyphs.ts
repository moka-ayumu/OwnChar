import { isHangulSyllable } from '@/font/hangul';
import type { RawStroke } from '@/font/stroke/outline';
import { BASE_CHARACTER_PROMPTS } from './prompts';

/** A glyph the writer drew whole, for one character or for a run of characters that it replaces as a ligature. */
export interface CustomGlyph {
	/** The characters it stands for. Also its key in the project. */
	text: string;
	/** Raw strokes in the canvas of `text.length` cells side by side, the first cell at the origin. */
	elements: readonly RawStroke[];
	cellSize: number;
	updatedAt: number;
}

/** `replace` fixes a glyph the font composes or writes anyway, `add` gives a character the font lacks, `ligature` swaps a run of characters. */
export type CustomKind = 'replace' | 'add' | 'ligature';

export const CUSTOM_CELL_SIZE = 184;
export const MAX_CUSTOM_LENGTH = 4;

/** Shown to a writer who has made none yet. */
export const RECOMMENDED_CUSTOM = ['ㅋㅋ', 'ㅎㅎ', 'ㅠㅠ', '♡'];

const BASE_CHARS = new Set(BASE_CHARACTER_PROMPTS.map((prompt) => prompt.char));

/** The characters of `text`, one per code point. */
export const customChars = (text: string) => [...text];

/** One to four characters, none of them blank. */
export function isCustomText(text: string) {
	const length = customChars(text).length;
	return length >= 1 && length <= MAX_CUSTOM_LENGTH && !/\s/u.test(text);
}

export function customKind(text: string): CustomKind {
	const chars = customChars(text);
	if (chars.length > 1) return 'ligature';
	return isHangulSyllable(chars[0].codePointAt(0)!) || BASE_CHARS.has(chars[0]) ? 'replace' : 'add';
}

export const CUSTOM_KIND_LABELS: Record<CustomKind, string> = { replace: '대체', add: '추가', ligature: '합자' };

/** When each glyph was last drawn: what a font is compared with, since a restored project holds the same glyphs as other objects. */
export function customStamps(glyphs: Record<string, CustomGlyph>): Record<string, number> {
	return Object.fromEntries(Object.values(glyphs).map((glyph) => [glyph.text, glyph.updatedAt]));
}

/** The part of the canvas the ink fills, with a margin for the pen. The band of one cell for each character while nothing is written. */
export function customBounds(text: string, elements: readonly RawStroke[], cellSize = CUSTOM_CELL_SIZE) {
	const margin = 14;
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const stroke of elements) {
		if (stroke.isDeleted) continue;
		for (const [x, y] of stroke.points) {
			left = Math.min(left, stroke.x + x - margin);
			right = Math.max(right, stroke.x + x + margin);
			top = Math.min(top, stroke.y + y - margin);
			bottom = Math.max(bottom, stroke.y + y + margin);
		}
	}
	if (left > right) return { x: 0, y: 0, width: customChars(text).length * cellSize, height: cellSize };
	return { x: left, y: top, width: right - left, height: bottom - top };
}

export function hasCustomInk(elements: readonly RawStroke[]) {
	return elements.some((stroke) => !stroke.isDeleted && stroke.points.length);
}
