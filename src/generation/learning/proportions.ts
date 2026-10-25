import type { WritingSessionRecord } from '@/collection/records';
import { decomposeHangul, HANGUL_ROLES } from '@/font/hangul';
import { jamoSize, proportionContext, proportionPair, type ProportionProfile, type RoleRatios } from '@/font/layout/proportion-profile';
import type { RawStroke } from '@/font/stroke/outline';
import { completedHangulCells, trimmedMean } from './samples';

function centerlineBox(strokes: RawStroke[]) {
	const points = strokes.flatMap((stroke) => stroke.points.map(([x, y]) => [stroke.x + x, stroke.y + y] as const));
	if (!points.length) return null;
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

type Samples = { medial: number[]; final: number[] };

function summarize(groups: Map<string, Samples>): Record<string, RoleRatios> {
	return Object.fromEntries(
		[...groups].map(([key, samples]) => [
			key,
			{
				medial: trimmedMean(samples.medial),
				final: trimmedMean(samples.final),
				sampleCount: Math.max(samples.medial.length, samples.final.length)
			}
		])
	);
}

/** Learn how large the user writes medial and final jamo relative to the initial. */
export function learnProportions(sessions: Record<string, WritingSessionRecord>): ProportionProfile {
	const contexts = new Map<string, Samples>();
	const pairs = new Map<string, Samples>();
	const syllables = new Map<string, Samples>();
	const add = (map: Map<string, Samples>, key: string, role: 'medial' | 'final', value: number) => {
		const samples = map.get(key) ?? { medial: [], final: [] };
		samples[role].push(value);
		map.set(key, samples);
	};
	for (const { cell, assigned } of completedHangulCells(sessions)) {
		const { kind, chars } = decomposeHangul(cell.char.codePointAt(0)!);
		const boxes = assigned.map(centerlineBox);
		if (boxes.some((box) => !box)) continue;
		const sizes = boxes.map((box, index) => jamoSize(HANGUL_ROLES[index], kind, box!.width, box!.height));
		const initial = sizes[0];
		if (initial < 1) continue;
		const hasFinal = cell.slots.length > 2;
		const keys: Array<[Map<string, Samples>, string]> = [
			[contexts, proportionContext(kind, hasFinal)],
			[pairs, proportionPair(chars.initial, chars.medial, chars.final || undefined)],
			[syllables, cell.char]
		];
		for (const [map, key] of keys) {
			add(map, key, 'medial', sizes[1] / initial);
			if (hasFinal) add(map, key, 'final', sizes[2] / initial);
		}
	}
	return { contexts: summarize(contexts), pairs: summarize(pairs), syllables: summarize(syllables) };
}
