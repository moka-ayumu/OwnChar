import { readFileSync } from 'node:fs';
import * as ot from '../../node_modules/opentype.js/dist/opentype.mjs';

export const opentype = ot.default ?? ot;

const notoFile = new URL('../../Noto_Sans_KR.local/static/NotoSansKR-Regular.ttf', import.meta.url);

/** Noto Sans KR is spatial reference data only. Product code never uses it. */
export function loadNoto() {
	const buffer = readFileSync(notoFile);
	const font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
	return { font, scale: 1000 / font.unitsPerEm };
}

/** Returns the path commands of a character, scaled to 1000 units per em. */
export function notoCommands({ font, scale }, char) {
	return font.charToGlyph(char).path.commands.map((c) => Object.fromEntries(Object.entries(c).map(([key, value]) => [key, typeof value === 'number' ? value * scale : value])));
}
