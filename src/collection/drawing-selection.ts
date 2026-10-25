import { expectedStrokeCount, sessionCaptures } from './exercises';
import { basePromptId, promptRole } from './prompts';
import type { DrawingRecord, WritingSessionRecord } from './records';

/** The stored drawing when `next` repeats it, so what did not change keeps its identity. */
export function keepIfSame(previous: DrawingRecord | undefined, next: DrawingRecord) {
	if (!previous || previous.previewSvg !== next.previewSvg || previous.codePoint !== next.codePoint || previous.derivedFromPromptId !== next.derivedFromPromptId) return next;
	const { exerciseId, cellIndex, slotIndex } = next.capture;
	if (previous.capture.exerciseId !== exerciseId || previous.capture.cellIndex !== cellIndex || previous.capture.slotIndex !== slotIndex) return next;
	if (previous.elements.length !== next.elements.length) return next;
	const same = previous.elements.every((stroke, index) => stroke.id === next.elements[index].id && stroke.version === next.elements[index].version && Boolean(stroke.isDeleted) === Boolean(next.elements[index].isDeleted));
	return same ? previous : next;
}

/** Spacing, in canvas pixels, the strokes are resampled to before their turns are read. */
const SAMPLE_SPACING = 4;
/** A turn smaller than this, in radians, is not counted as a change of direction. */
const TURN_THRESHOLD = 0.25;
/** Width of a jamo, as the square root of its ink area per cell width, below which it counts as too small. */
const SMALL_JAMO = 0.2;

const resample = (points: ReadonlyArray<readonly number[]>) => {
	const result: Array<[number, number]> = [];
	let carried = 0;
	for (let index = 1; index < points.length; index += 1) {
		const [x0, y0] = points[index - 1];
		const [x1, y1] = points[index];
		const length = Math.hypot(x1 - x0, y1 - y0);
		if (length === 0) continue;
		let at = SAMPLE_SPACING - carried;
		for (; at <= length; at += SAMPLE_SPACING) result.push([x0 + ((x1 - x0) * at) / length, y0 + ((y1 - y0) * at) / length]);
		carried = length - (at - SAMPLE_SPACING);
	}
	return result;
};

interface Measure {
	/** How far the stroke count is from the usual one, in usual counts. */
	count: number;
	/** Changes of turning direction per 100 pixels of stroke: a steady curve has none, a shaking hand many. */
	shake: number;
	/** How much smaller than a usual jamo it is, as a log ratio. */
	small: number;
	aspect: number;
}

const measures = new WeakMap<DrawingRecord, Measure>();

function measure(record: DrawingRecord, cellSize: number): Measure {
	const cached = measures.get(record);
	if (cached) return cached;
	const strokes = record.elements.filter((stroke) => !stroke.isDeleted && stroke.points.length);
	const expected = expectedStrokeCount(String.fromCodePoint(record.codePoint));
	let flips = 0;
	let length = 0;
	let x1 = Infinity;
	let y1 = Infinity;
	let x2 = -Infinity;
	let y2 = -Infinity;
	for (const stroke of strokes) {
		for (const [x, y] of stroke.points) {
			x1 = Math.min(x1, stroke.x + x);
			x2 = Math.max(x2, stroke.x + x);
			y1 = Math.min(y1, stroke.y + y);
			y2 = Math.max(y2, stroke.y + y);
		}
		const samples = resample(stroke.points);
		length += Math.max(0, samples.length - 1) * SAMPLE_SPACING;
		let heading: number | undefined;
		let side = 0;
		for (let index = 1; index < samples.length; index += 1) {
			const next = Math.atan2(samples[index][1] - samples[index - 1][1], samples[index][0] - samples[index - 1][0]);
			if (heading !== undefined) {
				let turn = next - heading;
				if (turn > Math.PI) turn -= 2 * Math.PI;
				if (turn < -Math.PI) turn += 2 * Math.PI;
				if (Math.abs(turn) >= TURN_THRESHOLD) {
					const sign = Math.sign(turn);
					if (side !== 0 && sign !== side) flips += 1;
					side = sign;
				}
			}
			heading = next;
		}
	}
	const width = Math.max(1, x2 - x1);
	const height = Math.max(1, y2 - y1);
	const result = {
		count: Math.abs(strokes.length - expected) / expected,
		shake: length > 0 ? flips / (length / 100) : 0,
		small: strokes.length ? Math.max(0, Math.log(SMALL_JAMO / (Math.sqrt(width * height) / cellSize))) : 0,
		aspect: strokes.length ? width / height : 1
	};
	measures.set(record, result);
	return result;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * The best of the drawings written for one jamo, by a score where lower is
 * better: a stroke count unlike the usual one, strokes that change direction
 * back and forth, a jamo far smaller than usual, and a width for its height
 * unlike the other drawings of the jamo. A tie keeps `current`, then the latest.
 */
export function bestDrawing(candidates: DrawingRecord[], cellSize: (record: DrawingRecord) => number, current?: DrawingRecord) {
	if (candidates.length === 1) return candidates[0];
	const typical = candidates.length > 2 ? Math.log(median(candidates.map((candidate) => measure(candidate, cellSize(candidate)).aspect))) : undefined;
	const score = (candidate: DrawingRecord) => {
		const { count, shake, small, aspect } = measure(candidate, cellSize(candidate));
		return 2 * count + 0.5 * shake + small + (typical === undefined ? 0 : Math.abs(Math.log(aspect) - typical));
	};
	const inUse = (record: DrawingRecord) => Boolean(current) && record.capture.exerciseId === current!.capture.exerciseId && record.capture.cellIndex === current!.capture.cellIndex && record.capture.slotIndex === current!.capture.slotIndex;
	let best = candidates[0];
	let bestScore = score(best);
	for (const candidate of candidates.slice(1)) {
		const value = score(candidate);
		const better = value < bestScore - 1e-9;
		const tied = Math.abs(value - bestScore) <= 1e-9;
		if (better || (tied && !inUse(best) && (inUse(candidate) || candidate.updatedAt > best.updatedAt))) {
			best = candidate;
			bestScore = value;
		}
	}
	return best;
}

/** How well a contextual jamo stands in for the standalone one: open-syllable forms first, finals last. */
function sourcePriority(promptId: string) {
	if (promptRole(promptId) === 'final') return 1;
	return Number(promptId.split('-')[1]) === 0 ? 3 : 2;
}

/**
 * The drawing each prompt is made from: the best of everything written for it
 * in any sentence. A contextual jamo also serves as the standalone consonant
 * or vowel, unless a better form of it is already in use. What did not change
 * keeps its object, so caches keyed on drawings stay valid.
 */
export function selectDrawings(sessions: Record<string, WritingSessionRecord>, previous: Record<string, DrawingRecord>) {
	const candidates = new Map<string, DrawingRecord[]>();
	for (const [exerciseId, session] of Object.entries(sessions)) {
		for (const record of sessionCaptures(exerciseId, session, previous)) {
			const list = candidates.get(record.promptId);
			if (list) list.push(record);
			else candidates.set(record.promptId, [record]);
		}
	}
	const cellSize = (record: DrawingRecord) => sessions[record.capture.exerciseId]?.cellSize ?? 1;
	const drawings: Record<string, DrawingRecord> = {};
	const standalone = new Map<string, DrawingRecord>();
	for (const [promptId, list] of candidates) {
		const best = keepIfSame(previous[promptId], bestDrawing(list, cellSize, previous[promptId]));
		drawings[promptId] = best;
		const role = promptRole(promptId);
		if (!role) continue;
		const standalonePrompt = basePromptId(role === 'medial' ? 'vowel' : 'consonant', String.fromCodePoint(best.codePoint));
		const chosen = standalone.get(standalonePrompt);
		if (!chosen || sourcePriority(promptId) > sourcePriority(chosen.promptId) || (sourcePriority(promptId) === sourcePriority(chosen.promptId) && previous[standalonePrompt]?.derivedFromPromptId === promptId))
			standalone.set(standalonePrompt, best);
	}
	for (const [promptId, source] of standalone) {
		if (drawings[promptId]) continue;
		drawings[promptId] = keepIfSame(previous[promptId], { ...source, promptId, derivedFromPromptId: source.promptId });
	}
	return drawings;
}
