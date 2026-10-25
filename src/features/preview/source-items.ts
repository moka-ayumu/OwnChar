import { BASE_CHARACTER_PROMPTS } from '@/collection/prompts';
import { customChars, hasCustomInk, type CustomGlyph } from '@/collection/custom-glyphs';
import type { DrawingRecord } from '@/collection/records';
import { isHangulSyllable } from '@/font/hangul';

/** One row of the source popover: a character, or a run of characters the font swaps for a glyph drawn whole. */
export interface SourceItem {
	text: string;
	/** The glyph drawn whole that stands for `text`. */
	custom?: CustomGlyph;
}

/**
 * What the font draws for the part of `text` from `start` to `end` (indices of the string), as it does: the
 * longest ligature drawn whole at each place, else a glyph drawn whole for the character, else the character with
 * the handwriting it is made of. A ligature is listed when any of its characters is in the selection.
 * Characters with no handwriting behind them are left out.
 */
export function sourceItems(text: string, start: number, end: number, customGlyphs: Record<string, CustomGlyph>, drawings: Record<string, DrawingRecord>): SourceItem[] {
	const written = Object.values(customGlyphs).filter((glyph) => hasCustomInk(glyph.elements));
	const ligatures = written.filter((glyph) => customChars(glyph.text).length > 1).sort((a, b) => customChars(b.text).length - customChars(a.text).length);
	const items: SourceItem[] = [];
	for (let index = 0; index < text.length;) {
		const rest = text.slice(index);
		const ligature = ligatures.find((glyph) => rest.startsWith(glyph.text));
		const length = ligature ? ligature.text.length : String.fromCodePoint(text.codePointAt(index)!).length;
		const selected = index < end && index + length > start;
		if (selected) {
			const char = text.slice(index, index + length);
			const custom = ligature ?? written.find((glyph) => glyph.text === char);
			if (custom) items.push({ text: char, custom });
			else if (isHangulSyllable(char.codePointAt(0)!) || BASE_CHARACTER_PROMPTS.some((prompt) => prompt.char === char && drawings[prompt.id])) items.push({ text: char });
		}
		index += length;
	}
	return items;
}
