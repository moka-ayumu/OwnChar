/** Representative syllables. AGENTS.md uses this list for glyph checks. */
export const REQUIRED_CHARS = [...'괌낡넘뢒뢥꽈깲뇲줬계뭐가고구그각곡굵읽닭']
export const REQUIRED = REQUIRED_CHARS.map((char) => char.codePointAt(0))

/** 84 syllables: 19 initials, each with 4 final types. */
export const MATRIX = Array.from({ length: 84 }, (_, i) => 0xac00 + i % 19 * 588 + Math.floor(i / 4) * 28 + [0, 1, 9, 10][i % 4])

/** Returns true if a path command has a coordinate that is not finite. */
export const hasNonFinite = (commands) => commands.some((c) => Object.values(c).some((v) => typeof v === 'number' && !Number.isFinite(v)))
