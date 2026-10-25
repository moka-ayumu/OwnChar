import opentype from 'opentype.js';
import { describe, expect, test } from 'vitest';
import type { CustomGlyph } from '@/collection/custom-glyphs';
import { customBaseEntries, customEntries, customSyllables, LIGATURE_BASE, ligatureRules } from '@/generation/custom-glyphs';
import { GlyphEncoder, NOTDEF, writeOtf } from '@/generation/otf-writer';
import { penStroke } from './helpers';

const glyph = (text: string): CustomGlyph => ({
	text,
	elements: [
		penStroke(`s-${text}`, 20, 20, [
			[0, 0],
			[60, 60]
		])
	],
	cellSize: 160,
	updatedAt: 1
});
const written = (...texts: string[]) => Object.fromEntries(texts.map((text) => [text, glyph(text)]));

describe('glyphs drawn whole', () => {
	test('a syllable replaces the composed one and a ligature takes a private-use code point', () => {
		const glyphs = written('ㅋㅋㅋ', '가', 'ㅋㅋ', '♡');
		expect(customSyllables(glyphs).has(0xac00)).toBe(true);
		expect(
			customBaseEntries(glyphs)
				.map((entry) => entry.codePoint)
				.sort()
		).toEqual([0x2661, LIGATURE_BASE, LIGATURE_BASE + 1].sort());
		expect(customEntries(glyphs).find((entry) => entry.glyph.text === 'ㅋㅋ')?.codePoint).toBe(LIGATURE_BASE);
	});

	test('the font substitutes the longest run first', () => {
		const rules = ligatureRules(written('ㅋㅋ', 'ㅋㅋㅋ'));
		expect(rules.map((rule) => rule.sequence.length)).toEqual([3, 2]);
		const out = new GlyphEncoder();
		const box = () => {
			const path = new opentype.Path();
			path.moveTo(0, 0);
			path.lineTo(100, 100);
			path.lineTo(0, 100);
			path.close();
			return path;
		};
		out.add(NOTDEF, box(), 700);
		for (const codePoint of [0x314b, LIGATURE_BASE, LIGATURE_BASE + 1]) out.add(codePoint, box(), 1000);
		const font = opentype.parse(writeOtf({ familyName: 'T', styleName: 'Regular', designer: '', version: '1.0' }, [out.finish()], rules));
		const sets = font.tables.gsub.lookups[0].subtables[0].ligatureSets[0] as Array<{ components: number[] }>;
		expect(sets.map((set) => set.components.length)).toEqual([2, 1]);
	});
});
