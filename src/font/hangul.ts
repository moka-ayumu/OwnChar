export type HangulRole = 'initial' | 'medial' | 'final';
export const HANGUL_ROLES: readonly HangulRole[] = ['initial', 'medial', 'final'];

/** How a vowel sits next to its initial: beside it, below it, or both. */
export type VowelKind = 'vertical' | 'horizontalUp' | 'horizontalDown' | 'mixed';

export const INITIALS = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
export const MEDIALS = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
export const FINALS = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

/** Compound finals are composed from their two single finals when not written directly. */
export const COMPOUND_FINALS: Record<string, [string, string]> = {
	ㄳ: ['ㄱ', 'ㅅ'],
	ㄵ: ['ㄴ', 'ㅈ'],
	ㄶ: ['ㄴ', 'ㅎ'],
	ㄺ: ['ㄹ', 'ㄱ'],
	ㄻ: ['ㄹ', 'ㅁ'],
	ㄼ: ['ㄹ', 'ㅂ'],
	ㄽ: ['ㄹ', 'ㅅ'],
	ㄾ: ['ㄹ', 'ㅌ'],
	ㄿ: ['ㄹ', 'ㅍ'],
	ㅀ: ['ㄹ', 'ㅎ'],
	ㅄ: ['ㅂ', 'ㅅ']
};

/** Double consonants are composed from two of their single consonant when not written directly. */
export const DOUBLE_CONSONANTS: Record<string, string> = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' };

/** The two jamo a compound final or a double consonant is composed from. */
export function jamoParts(char: string): [string, string] | undefined {
	const single = DOUBLE_CONSONANTS[char];
	return single ? [single, single] : COMPOUND_FINALS[char];
}

export const HANGUL_BASE = 0xac00;
export const HANGUL_COUNT = 11_172;

export function isHangulSyllable(codePoint: number) {
	return codePoint >= HANGUL_BASE && codePoint < HANGUL_BASE + HANGUL_COUNT;
}

function vowelKind(index: number): VowelKind {
	return index <= 7 || index === 20 ? 'vertical' : [8, 12].includes(index) ? 'horizontalUp' : [13, 17, 18].includes(index) ? 'horizontalDown' : 'mixed';
}

// Initial layout of an open syllable, per vowel.
// 0 vertical, 1 ㅗ/ㅛ/ㅡ, 2 ㅜ/ㅠ, 3 ㅘ/ㅙ/ㅚ/ㅢ, 4 ㅝ/ㅞ/ㅟ; with a final: 5 vertical, 6 horizontal, 7 mixed.
const openVariants = [0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 3, 1, 2, 4, 4, 4, 2, 1, 3, 0];

export function decomposeHangul(codePoint: number) {
	const offset = codePoint - HANGUL_BASE;
	const initialIndex = Math.floor(offset / 588);
	const vowelIndex = Math.floor((offset % 588) / 28);
	const finalIndex = offset % 28;
	const kind = vowelKind(vowelIndex);
	return {
		initialIndex,
		vowelIndex,
		finalIndex,
		kind,
		chars: { initial: INITIALS[initialIndex], medial: MEDIALS[vowelIndex], final: FINALS[finalIndex] },
		variants: { initial: finalIndex ? (kind === 'vertical' ? 5 : kind === 'mixed' ? 7 : 6) : openVariants[vowelIndex], medial: finalIndex ? 1 : 0, final: 0 }
	};
}

/** The roles a syllable has: every syllable has an initial and a medial. */
export function syllableRoles(codePoint: number): readonly HangulRole[] {
	return decomposeHangul(codePoint).finalIndex ? HANGUL_ROLES : ['initial', 'medial'];
}
