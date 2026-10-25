import opentype from 'opentype.js';
import { BASE_CHARACTER_PROMPTS, type CharacterPrompt } from '@/collection/prompts';
import { decomposeHangul, DOUBLE_CONSONANTS, FINALS, HANGUL_BASE, HANGUL_COUNT, HANGUL_ROLES, INITIALS, MEDIALS, type HangulRole } from '@/font/hangul';
import { prepareCffPath } from '@/font/geometry/cff';
import { mapPoints, pathOf, translatePath } from '@/font/geometry/path-ops';
import { appendShape, CELL_UNITS, scaleZone, stretchShapeWidth, type NormalizedShape, type Zone } from '@/font/geometry/shape';
import { DESCENDER_LIMIT, renderCalibratedGlyph, visualCalibrationScale, VISUAL_HANGUL_HEIGHT } from '@/font/glyphs/calibration';
import { composeStandaloneJamoPath, type ReferenceEnvelope } from '@/font/glyphs/standalone-jamo';
import { appendNumeral, appendSymbol, symbolCalibrationAnchor, symbolMaximumHeight } from '@/font/glyphs/symbols';
import { composeHangulParts, composeHangulPath, learnSizeTargets, type HangulComposeOptions, type HangulParts } from '@/font/layout/compose-syllable';
import type { SizeTargets } from '@/font/layout/syllable-layout';
import { selectJamoSource } from '@/font/layout/source-selection';
import { latestOnly } from '@/lib/latest-only';
import { alignVerticalCenter, medianHeight, normalizationFactor } from '@/font/metrics';
import type { CompositionSettings } from '@/font/settings';
import { customBaseEntries, customGlyph, customSyllables, ligatureRules, syllableAdvance } from './custom-glyphs';
import { shapesFromRequestDrawings } from './inputs';
import { GlyphEncoder, NOTDEF, writeOtf, type EncodedGlyphs } from './otf-writer';
import type { CompositionProfile, GenerationRequest, GlyphOverride } from './request';

export interface ComposeOptions {
	cancelled: () => boolean;
	progress: (stage: string, progress: number, message: string) => void;
	yieldControl?: () => Promise<void>;
	/** Every syllable, already encoded in code point order. */
	encodedHangul?: EncodedGlyphs[];
	/** Outlines to use for the syllables instead of composing them. */
	hangulSource?: HangulSource;
	preparedContext?: PreparedCompositionContext;
}

export type HangulSource = (codePoint: number) => opentype.Path['commands'];
export interface PreparedCompositionContext {
	shapes: Map<string, NormalizedShape>;
	visualScale: number;
	sizeTargets?: SizeTargets;
}

/** The part of a generation request that decides how a Hangul syllable is composed. */
export type HangulCompositionInputs = CompositionProfile & { compositionSettings: CompositionSettings; sizeTargets?: SizeTargets };

const LATIN_ZONE: Zone = { x: 90, y: 80, width: 820, height: 720 };
const LATIN_BASELINE = LATIN_ZONE.y;

function createNotdef() {
	const path = new opentype.Path();
	path.moveTo(80, 0);
	path.lineTo(80, 800);
	path.lineTo(620, 800);
	path.lineTo(620, 0);
	path.close();
	path.moveTo(150, 90);
	path.lineTo(550, 90);
	path.lineTo(550, 710);
	path.lineTo(150, 710);
	path.close();
	return path;
}

/** Letters sharing a height and baseline: capitals, x-height letters, ascenders, descenders. */
function latinClass(prompt: CharacterPrompt) {
	if (prompt.group === 'uppercase') return 'uppercase';
	if ('bdfhklt'.includes(prompt.char)) return 'lowercase-tall';
	if ('gjpqy'.includes(prompt.char)) return 'lowercase-descender';
	return 'lowercase-x';
}

/** The per-glyph override on top of the global metrics. */
export function mergedOverride(request: Pick<GenerationRequest, 'overrides' | 'globalMetrics'>, codePoint: number): GlyphOverride {
	const specific = request.overrides[codePoint];
	return {
		left: request.globalMetrics.left + (specific?.left ?? 0),
		right: request.globalMetrics.right + (specific?.right ?? 0),
		y: request.globalMetrics.y + (specific?.y ?? 0),
		scale: specific?.scale ?? 1,
		rotation: specific?.rotation ?? 0
	};
}

/** Scales and rotates a glyph about the centre of its ink, then raises it. */
function applyOverride(path: opentype.Path, override: GlyphOverride) {
	const box = path.getBoundingBox();
	const centerX = (box.x1 + box.x2) / 2;
	const centerY = (box.y1 + box.y2) / 2;
	const radians = (override.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	mapPoints(path.commands, (px, py) => {
		const x = (px - centerX) * override.scale;
		const y = (py - centerY) * override.scale;
		return [x * cos - y * sin + centerX, x * sin + y * cos + centerY + override.y];
	});
}

/** Writes a glyph into `out` with its overrides and metrics applied, its overlapping contours merged. */
export function encodeGlyph(out: GlyphEncoder, codePoint: number, path: opentype.Path, baseAdvanceWidth: number, request: GenerationRequest) {
	const override = mergedOverride(request, codePoint);
	const mode = request.compositionSettings.widthMode;
	if (path.commands.length) applyOverride(path, override);
	path = prepareCffPath(path);
	let advanceWidth = baseAdvanceWidth + override.left + override.right;
	if (path.commands.length && mode === 'proportional') {
		const box = path.getBoundingBox();
		const leftBearing = 55 + override.left;
		const rightBearing = 55 + override.right;
		translatePath(path, leftBearing - box.x1, 0);
		advanceWidth = Math.max(100, leftBearing + box.x2 - box.x1 + rightBearing);
	} else if (path.commands.length && override.left) {
		translatePath(path, override.left, 0);
	}
	out.add(codePoint, path, advanceWidth);
}

export function hangulComposeOptions(
	request: CompositionProfile & { sizeTargets?: SizeTargets }
): Required<Pick<HangulComposeOptions, 'gaps' | 'proportions' | 'targetHeight' | 'targetSize' | 'targetCenter'>> & Pick<HangulComposeOptions, 'sizeTargets'> {
	return { gaps: request.gaps, proportions: request.proportions, targetHeight: request.hangulTargetHeight, targetSize: request.hangulTargetSize, targetCenter: request.hangulTargetCenter, sizeTargets: request.sizeTargets };
}

const cachedSizeTargets = latestOnly(
	(
		shapes: Map<string, NormalizedShape>,
		_gaps: CompositionProfile['gaps'],
		_proportions: CompositionProfile['proportions'],
		_height: number,
		_size: number,
		_initial: number,
		_medial: number,
		_final: number,
		inputs: HangulCompositionInputs
	) => learnSizeTargets(shapes, inputs.compositionSettings, hangulComposeOptions(inputs)),
	8
);

/** `inputs` with what its size dials draw toward. The dials change nothing without it, so it is learned only once one of them is above 0. */
export function withSizeTargets<Inputs extends HangulCompositionInputs>(shapes: Map<string, NormalizedShape>, inputs: Inputs): Inputs {
	const settings = inputs.compositionSettings;
	if (!(settings.initialNormalization > 0 || settings.medialNormalization > 0 || settings.finalNormalization > 0 || settings.widthNormalization > 0)) return inputs;
	return {
		...inputs,
		sizeTargets: cachedSizeTargets(shapes, inputs.gaps, inputs.proportions, inputs.hangulTargetHeight, inputs.hangulTargetSize, settings.singleInitialScale, settings.vowelScale, settings.finalScale, { ...inputs, sizeTargets: undefined })
	};
}

/** Options for the guides of the writing page: syllables at the size the writer writes them, not the size the font is built at. */
export function guideComposeOptions(request: CompositionProfile): ReturnType<typeof hangulComposeOptions> {
	const options = hangulComposeOptions(request);
	return { ...options, sizeTargets: undefined, targetHeight: request.hangulWrittenHeight ?? options.targetHeight, targetSize: request.hangulWrittenSize ?? options.targetSize };
}

export function prepareCompositionContext(request: GenerationRequest): PreparedCompositionContext {
	const shapes = shapesFromRequestDrawings(request.drawings, request.compositionSettings);
	// The calibration and the base glyphs stay as they are when a size dial moves: neither reads the targets.
	return { shapes, visualScale: visualCalibrationScale(shapes, request.compositionSettings, hangulComposeOptions(request)), sizeTargets: withSizeTargets<HangulCompositionInputs>(shapes, request).sizeTargets };
}

/** The ink envelope of 가, which standalone jamo are sized against. */
export function jamoReference(shapes: Map<string, NormalizedShape>, request: HangulCompositionInputs, visualScale: number): ReferenceEnvelope {
	const path = composeHangulPath('가'.codePointAt(0)!, shapes, request.compositionSettings, { ...hangulComposeOptions(request), sizeTargets: undefined });
	if (!path.commands.length) return { width: VISUAL_HANGUL_HEIGHT / visualScale, height: VISUAL_HANGUL_HEIGHT / visualScale, centerX: 500, centerY: request.hangulTargetCenter };
	const box = path.getBoundingBox();
	return { width: box.x2 - box.x1, height: box.y2 - box.y1, centerX: (box.x1 + box.x2) / 2, centerY: (box.y1 + box.y2) / 2 };
}

/** The envelope a standalone jamo is sized against: its own ink size inside syllables, centred as `whole`. */
export function standaloneJamoReference(char: string, shapes: Map<string, NormalizedShape>, request: HangulCompositionInputs, whole: ReferenceEnvelope): ReferenceEnvelope {
	const initial = INITIALS.indexOf(char);
	const medial = MEDIALS.indexOf(char);
	const final = FINALS.indexOf(char);
	const [index, role]: [number, HangulRole] = initial >= 0 ? [initial * 588, 'initial'] : medial >= 0 ? [medial * 28, 'medial'] : [final, 'final'];
	if (initial < 0 && medial < 0 && final <= 0) return whole;
	const part = composeHangulParts(HANGUL_BASE + index, shapes, request.compositionSettings, { ...hangulComposeOptions(request), sizeTargets: undefined }).parts[role];
	if (!part.commands.length) return whole;
	const box = part.getBoundingBox();
	return { ...whole, width: box.x2 - box.x1, height: box.y2 - box.y1 };
}

/** A syllable exactly as it is written to the font, before metrics and overrides. */
export function composedHangulPath(codePoint: number, shapes: Map<string, NormalizedShape>, request: HangulCompositionInputs, visualScale: number) {
	return composedHangulParts(codePoint, shapes, request, visualScale).path;
}

const cachedInitialWidths = latestOnly((_shapes: Map<string, NormalizedShape>, _request: HangulCompositionInputs, _visualScale: number) => new Map<number, number>(), 3);

/** Calibrated role geometry shared by export, previews, and diagnostics. */
export function composedHangulParts(codePoint: number, shapes: Map<string, NormalizedShape>, request: HangulCompositionInputs, visualScale: number): HangulParts {
	const options = hangulComposeOptions(request);
	let result: HangulParts | undefined;
	let original: opentype.BoundingBox | undefined;
	const path = renderCalibratedGlyph(
		(penScale) => {
			result = composeHangulParts(codePoint, shapes, request.compositionSettings, { ...options, penScale });
			original = result.path.getBoundingBox();
			return result.path;
		},
		visualScale,
		request.hangulTargetCenter,
		450,
		request.compositionSettings.widthMode === 'fixed'
	);
	const box = path.getBoundingBox();
	if (original && path.commands.length) {
		// Carry the calibration over to the role geometry.
		const scale = (box.y2 - box.y1) / Math.max(1e-6, original.y2 - original.y1);
		const dx = box.x1 - original.x1 * scale;
		const dy = box.y1 - original.y1 * scale;
		const { zones, anchors, scales } = result!.geometry;
		for (const role of HANGUL_ROLES) {
			const zone = zones[role];
			if (zone) zones[role] = { x1: zone.x1 * scale + dx, y1: zone.y1 * scale + dy, x2: zone.x2 * scale + dx, y2: zone.y2 * scale + dy };
			const anchor = anchors[role];
			if (anchor) anchors[role] = { x: anchor.x * scale + dx, y: anchor.y * scale + dy };
			if (scales[role] !== undefined) scales[role]! *= scale;
		}
	}
	const { chars, kind, initialIndex, variants } = decomposeHangul(codePoint);
	const single = DOUBLE_CONSONANTS[chars.initial];
	const widths = cachedInitialWidths(shapes, request, visualScale);
	if (!single && result!.parts.initial.commands.length) {
		const box = result!.parts.initial.getBoundingBox();
		widths.set(codePoint, box.x2 - box.x1);
	}
	if (single && kind === 'vertical' && result!.parts.initial.commands.length) {
		const reference = codePoint + (INITIALS.indexOf(single) - initialIndex) * MEDIALS.length * FINALS.length;
		if (!widths.has(reference)) composedHangulParts(reference, shapes, request, visualScale);
		const source = selectJamoSource(shapes, 'initial', variants.initial, chars.initial)?.source;
		const width = widths.get(reference);
		if (source && width) {
			const before = result!.parts.initial.getBoundingBox();
			const height = before.y2 - before.y1;
			let shape = source;
			let scale = height / (source.frame.height * CELL_UNITS);
			let initial = new opentype.Path();
			for (let pass = 0; pass < 8; pass += 1) {
				initial = new opentype.Path();
				appendShape(initial, shape, { x: 0, y: 0, width: CELL_UNITS * scale, height: CELL_UNITS * scale }, true, visualScale);
				const box = initial.getBoundingBox();
				const x = width / (box.x2 - box.x1);
				const y = height / (box.y2 - box.y1);
				if (Math.abs(x - 1) < 0.00001 && Math.abs(y - 1) < 0.00001) break;
				shape = stretchShapeWidth(shape, x / y);
				scale *= y;
			}
			const box = initial.getBoundingBox();
			mapPoints(initial.commands, (x, y) => [before.x2 - width + ((x - box.x1) * width) / (box.x2 - box.x1), before.y1 + ((y - box.y1) * height) / (box.y2 - box.y1)]);
			result!.parts.initial = initial;
			result!.path = pathOf(Object.values(result!.parts).flatMap((part) => part.commands));
			result!.geometry.anchors.initial = { x: before.x2 - width / 2, y: (before.y1 + before.y2) / 2 };
			result!.geometry.scales.initial = scale;
			result!.geometry.groups.initial = 'initial';
			const zone = result!.geometry.zones.initial;
			if (zone) zone.x1 -= width - (before.x2 - before.x1);
		}
	}
	return result!;
}

/** Composes each syllable from the prepared shapes; a syllable the writer drew whole is that drawing. */
export function hangulComposer(request: GenerationRequest, prepared: PreparedCompositionContext): HangulSource {
	const inputs = { ...request, sizeTargets: prepared.sizeTargets };
	const fixed = customSyllables(request.customGlyphs);
	return (codePoint) => {
		const glyph = fixed.get(codePoint);
		return glyph ? customGlyph(glyph, request.compositionSettings).path.commands : composedHangulPath(codePoint, prepared.shapes, inputs, prepared.visualScale).commands;
	};
}

/** The syllables from index `start` up to `end`, encoded as they are written to the font. */
export function encodeHangulRange(request: GenerationRequest, start: number, end: number, source: HangulSource, progress?: (completed: number) => void): EncodedGlyphs {
	const out = new GlyphEncoder();
	const fixed = customSyllables(request.customGlyphs);
	for (let index = start; index < end; index += 1) {
		const codePoint = HANGUL_BASE + index;
		encodeGlyph(out, codePoint, pathOf(source(codePoint)), syllableAdvance(fixed, codePoint, request.compositionSettings), request);
		if ((index - start) % 112 === 0) progress?.(index - start + 1);
	}
	progress?.(end - start);
	return out.finish();
}

/** Standalone jamo, Latin letters, numerals and the symbols that were written. */
function encodeBaseGlyphs(out: GlyphEncoder, request: GenerationRequest, shapes: Map<string, NormalizedShape>, visualScale: number) {
	const settings = request.compositionSettings;
	const customEntries = customBaseEntries(request.customGlyphs);
	const drawn = new Set(customEntries.map((entry) => entry.codePoint));
	const fixedWidth = settings.widthMode === 'fixed';
	const reference = jamoReference(shapes, request, visualScale);

	// The calibration scales about the baseline; a letter under this height is not shifted alone by its limit.
	const capZone: Zone = { ...LATIN_ZONE, height: Math.min(LATIN_ZONE.height, (900 - LATIN_BASELINE) / visualScale) };
	// Capitals are normalized toward the median height of their class and stand on the baseline.
	const heights = new Map<string, number[]>();
	// Lowercase keeps its written size: one scale for all, one baseline, descenders hang below it.
	const written = new Map<string, number[]>();
	for (const prompt of BASE_CHARACTER_PROMPTS) {
		const shape = shapes.get(prompt.char);
		if (!shape) continue;
		const group = latinClass(prompt);
		if (prompt.group === 'lowercase') {
			written.set(group, [...(written.get(group) ?? []), shape.frame.height]);
			continue;
		}
		if (prompt.group !== 'uppercase') continue;
		const path = new opentype.Path();
		appendShape(path, shape, capZone);
		const box = path.getBoundingBox();
		heights.set(group, [...(heights.get(group) ?? []), box.y2 - box.y1]);
	}
	const targetHeight = (prompt: CharacterPrompt) => medianHeight(heights.get(latinClass(prompt)) ?? [], capZone.height);
	const lowerTall = medianHeight(written.get('lowercase-tall') ?? [...written.values()].flat(), 1);
	const upright = Math.max(...[...written].filter(([group]) => group !== 'lowercase-descender').flatMap(([, values]) => values), lowerTall);
	// The calibration scales about the baseline; the tallest letter must stay under the top limit so no glyph is shifted alone.
	const lowerScale = Math.min(LATIN_ZONE.height / lowerTall, (900 - LATIN_BASELINE) / (visualScale * upright));
	const maximumDrop = (LATIN_BASELINE - DESCENDER_LIMIT) / visualScale;
	const xHeight = medianHeight(written.get('lowercase-x') ?? [], lowerTall * 0.6) * lowerScale;
	const topLine = (shapes.get('a')?.frame.height ?? 0) * lowerScale || xHeight;

	/** Distance from the top of the ink to the top of its body, which leaves out a dot above it. */
	const bodyTopOffset = (shape: NormalizedShape) => {
		const bounds = shape.strokes.map((stroke) => {
			const ys = stroke.contours.flat().map(([, y]) => y);
			return { top: Math.min(...ys), bottom: Math.max(...ys) };
		});
		const body = bounds.filter((bound) => bound.bottom - bound.top >= shape.frame.height * 0.2);
		return body.length ? Math.min(...body.map((bound) => bound.top)) - shape.frame.y : 0;
	};

	/** Places a lowercase shape at its written size on the baseline; descenders hang so that their body does not rise above `a`. */
	const appendLowercase = (path: opentype.Path, prompt: CharacterPrompt, shape: NormalizedShape, penScale: number) => {
		const width = shape.frame.width * lowerScale;
		const height = shape.frame.height * lowerScale;
		const body = height - bodyTopOffset(shape) * lowerScale;
		const drop = latinClass(prompt) === 'lowercase-descender' ? Math.min(maximumDrop, Math.max(0, body - topLine)) : 0;
		const y = LATIN_BASELINE - drop;
		appendShape(path, shape, { x: 500 - width / 2, y, width, height }, false, penScale);
	};

	for (const prompt of BASE_CHARACTER_PROMPTS) {
		if (drawn.has(prompt.codePoint)) continue;
		const shape = shapes.get(prompt.char);
		if (prompt.group === 'symbol' && !shape) continue;
		const isJamo = prompt.group === 'consonant' || prompt.group === 'vowel';
		const isMark = prompt.group === 'symbol' || prompt.group === 'number';
		// Numerals are tall marks: they take the anchor and height limit of `!`.
		const markChar = prompt.group === 'number' ? '!' : prompt.char;
		const render = (penScale: number) => {
			const path = new opentype.Path();
			if (!shape) return path;
			if (prompt.group === 'symbol') appendSymbol(path, prompt.char, shape, penScale);
			else if (prompt.group === 'number') appendNumeral(path, shape, penScale);
			else if (isJamo) return pathOf(composeStandaloneJamoPath(shape, settings, standaloneJamoReference(prompt.char, shapes, request, reference), penScale).commands);
			else if (prompt.group === 'lowercase') appendLowercase(path, prompt, shape, penScale);
			else {
				appendShape(path, shape, capZone, false, penScale);
				const box = path.getBoundingBox();
				const factor = Math.min(normalizationFactor(box.y2 - box.y1, targetHeight(prompt), settings.latinNormalization), capZone.height / Math.max(1, box.y2 - box.y1));
				if (Math.abs(factor - 1) > 0.005) {
					path.commands.length = 0;
					appendShape(path, shape, scaleZone(capZone, factor), false, penScale);
				}
				const placed = path.getBoundingBox();
				alignVerticalCenter(path, LATIN_BASELINE + (placed.y2 - placed.y1) / 2, settings.verticalAlignment);
			}
			return path;
		};
		const anchor = isMark ? symbolCalibrationAnchor(markChar) : isJamo ? request.hangulTargetCenter : LATIN_BASELINE;
		const path = renderCalibratedGlyph(render, visualScale, anchor, isJamo ? 450 : anchor, fixedWidth, isMark ? symbolMaximumHeight(markChar) : 950);
		const baseAdvanceWidth = isJamo ? 1000 : prompt.group === 'symbol' ? 500 : 680;
		encodeGlyph(out, prompt.codePoint, path, baseAdvanceWidth, request);
	}

	for (const { codePoint, glyph } of customEntries) {
		const { path, advance } = customGlyph(glyph, settings);
		encodeGlyph(out, codePoint, path, advance, request);
	}
}

/** .notdef, the space, and every glyph that is not a syllable. */
export function encodeBaseBlock(request: GenerationRequest, prepared: PreparedCompositionContext): EncodedGlyphs {
	const base = new GlyphEncoder();
	base.add(NOTDEF, createNotdef(), 700);
	base.add(32, new opentype.Path(), 400);
	encodeBaseGlyphs(base, request, prepared.shapes, prepared.visualScale);
	return base.finish();
}

/** A font of `base` and only the syllables in `codePoints`, for a preview that follows the settings as they change. */
export function composeSubsetFont(request: GenerationRequest, base: EncodedGlyphs, codePoints: number[], source: HangulSource): ArrayBuffer {
	const syllables = new GlyphEncoder();
	const fixed = customSyllables(request.customGlyphs);
	for (const codePoint of [...codePoints].sort((a, b) => a - b)) encodeGlyph(syllables, codePoint, pathOf(source(codePoint)), syllableAdvance(fixed, codePoint, request.compositionSettings), request);
	return writeOtf(request.metadata, [base, syllables.finish()], ligatureRules(request.customGlyphs));
}

export async function composeFont(request: GenerationRequest, options: ComposeOptions) {
	const prepared = options.preparedContext ?? prepareCompositionContext(request);

	options.progress('latin', options.encodedHangul ? 94 : 2, '영문과 숫자를 정리하는 중');
	const blocks = [encodeBaseBlock(request, prepared)];

	if (options.encodedHangul) blocks.push(...options.encodedHangul);
	else {
		// A given source is not composition: it is read through without reporting or pausing.
		const composing = !options.hangulSource;
		if (composing) options.progress('hangul', 3, '한글 음절을 조합하는 중');
		const source = options.hangulSource ?? hangulComposer(request, prepared);
		for (let index = 0; index < HANGUL_COUNT; index += 112) {
			if (options.cancelled()) throw new DOMException('Generation cancelled', 'AbortError');
			blocks.push(encodeHangulRange(request, index, Math.min(HANGUL_COUNT, index + 112), source));
			if (composing) {
				const progress = 3 + Math.round((index / HANGUL_COUNT) * 91);
				options.progress('hangul', progress, `${index.toLocaleString()} / ${HANGUL_COUNT.toLocaleString()} 글자 조합 중`);
				await options.yieldControl?.();
			}
		}
	}

	options.progress('serialize', 96, 'OTF 파일을 마무리하는 중');
	const glyphCount = blocks.reduce((sum, block) => sum + block.codePoints.length, 0);
	return { buffer: writeOtf(request.metadata, blocks, ligatureRules(request.customGlyphs)), glyphCount };
}
