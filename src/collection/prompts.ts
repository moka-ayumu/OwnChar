import { COMPOUND_FINALS, DOUBLE_CONSONANTS, FINALS, INITIALS, MEDIALS, type HangulRole } from '@/font/hangul';

export type PromptGroup = 'consonant' | 'vowel' | 'uppercase' | 'lowercase' | 'number' | 'symbol' | 'initialVariant' | 'medialVariant' | 'finalVariant';

/** One thing the writer is asked for: a standalone character, or a jamo in one syllable layout. */
export interface CharacterPrompt {
	id: string;
	char: string;
	codePoint: number;
	group: PromptGroup;
	variantRole?: HangulRole;
	variantIndex?: number;
}

export const ROLE_LABELS: Record<HangulRole, string> = { initial: '초성', medial: '중성', final: '종성' };

export const SYMBOLS = [...`.,!?;:'"()[]+-=*/<>@#%&$_`];

const baseGroups: Array<[PromptGroup, string[]]> = [
	['consonant', [...'ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ']],
	['vowel', MEDIALS],
	['uppercase', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']],
	['lowercase', [...'abcdefghijklmnopqrstuvwxyz']],
	['number', [...'0123456789']],
	['symbol', SYMBOLS]
];

export function basePromptId(group: PromptGroup, char: string) {
	return `${group}-${char.codePointAt(0)}`;
}

export function variantPromptId(role: HangulRole, variant: number, char: string) {
	return `${role}-${variant}-${char.codePointAt(0)}`;
}

/** The role of a contextual jamo prompt, read from its id. */
export function promptRole(promptId: string | undefined): HangulRole | undefined {
	const role = promptId?.split('-')[0];
	return role === 'initial' || role === 'medial' || role === 'final' ? role : undefined;
}

export const BASE_CHARACTER_PROMPTS: CharacterPrompt[] = baseGroups.flatMap(([group, characters]) => characters.map((char) => ({ id: basePromptId(group, char), char, codePoint: char.codePointAt(0)!, group })));

function variantPrompts(group: PromptGroup, role: HangulRole, characters: string[], variants: number): CharacterPrompt[] {
	return Array.from({ length: variants }, (_, variantIndex) =>
		characters.map((char) => ({
			id: variantPromptId(role, variantIndex, char),
			char,
			codePoint: char.codePointAt(0)!,
			group,
			variantRole: role,
			variantIndex
		}))
	).flat();
}

// Initials have eight layouts and medials two (see `decomposeHangul`); finals share one.
const HANGUL_VARIANT_PROMPTS = [...variantPrompts('initialVariant', 'initial', INITIALS, 8), ...variantPrompts('medialVariant', 'medial', MEDIALS, 2), ...variantPrompts('finalVariant', 'final', FINALS.slice(1), 1)];

export const CHARACTER_PROMPTS: CharacterPrompt[] = [...BASE_CHARACTER_PROMPTS, ...HANGUL_VARIANT_PROMPTS];

// Only shapes that are frequent and have their own layout are written by hand.
// Initials: vertical (가), ㅗ/ㅛ/ㅡ (고), vertical + final (각), horizontal +
// final (곡). ㅜ/ㅠ reuse the ㅗ layout zone, and the compound-vowel layouts
// are fitted from the vertical ones. Medials with a final are uniformly fitted from
// the open form for the rare ㅒㅖㅙㅞㅢ. Double consonants and compound finals
// are composed from their parts.
const REQUIRED_INITIAL_VARIANTS = new Set([0, 1, 5, 6]);
const DERIVED_MEDIALS_WITH_FINAL = new Set([...'ㅒㅖㅙㅞㅢ']);

export function isRequiredPrompt(prompt: CharacterPrompt) {
	if (prompt.char in DOUBLE_CONSONANTS) return false;
	if (prompt.variantRole === 'initial') return REQUIRED_INITIAL_VARIANTS.has(prompt.variantIndex!);
	if (prompt.variantRole === 'medial') return prompt.variantIndex === 0 || !DERIVED_MEDIALS_WITH_FINAL.has(prompt.char);
	if (prompt.variantRole === 'final' || prompt.group === 'consonant') return !(prompt.char in COMPOUND_FINALS);
	return true;
}

export const REQUIRED_PROMPTS = CHARACTER_PROMPTS.filter(isRequiredPrompt);

export const PROMPT_COUNT = REQUIRED_PROMPTS.length;

export function completedPromptCount(drawings: Record<string, unknown>) {
	return REQUIRED_PROMPTS.reduce((count, prompt) => count + (drawings[prompt.id] ? 1 : 0), 0);
}

export function missingPrompts(drawings: Record<string, unknown>) {
	return REQUIRED_PROMPTS.filter((prompt) => !drawings[prompt.id]);
}
