import opentype from 'opentype.js';
import type { WritingSessionRecord } from '@/collection/records';
import { decomposeHangul, type VowelKind } from '@/font/hangul';
import { appendShape, CELL_UNITS, normalizeRawStrokes } from '@/font/geometry/shape';
import { finalGapContext, finalGapPair, gapContext, gapPair, medialGapContext, minimumGap, type GapProfile, type LearnedPlacement } from '@/font/layout/gap-profile';
import { finalAnchorX, finalTargetX, initialBodyDrop, medialSpace, type PlacedJamo } from '@/font/layout/syllable-layout';
import { penDiameter, strokePolygon, type RawStroke } from '@/font/stroke/outline';
import { cellMemo, collect, completedHangulCells, trimmedMean, type CompletedHangulCell } from './samples';

interface Bounds {
	left: number;
	right: number;
	top: number;
	bottom: number;
}
type Placement = Pick<LearnedPlacement, 'advanceGap' | 'crossOffset'>;

/** Ink bounds of a jamo inside its cell, in canvas pixels (y down). */
function boundsFor(strokes: RawStroke[], cellX: number, cellY: number, cellSize: number, endpointStabilization: number): Bounds | null {
	const points = strokes.flatMap((stroke) =>
		strokePolygon(
			stroke.points.map(([x, y]) => [stroke.x + x - cellX, stroke.y + y - cellY]),
			stroke.pressures,
			penDiameter(stroke.strokeWidth, cellSize),
			true,
			endpointStabilization
		)
	);
	if (!points.length) return null;
	return {
		left: Math.min(...points.map(([x]) => x)),
		right: Math.max(...points.map(([x]) => x)),
		top: Math.min(...points.map(([, y]) => y)),
		bottom: Math.max(...points.map(([, y]) => y))
	};
}

const mean = (values: number[], fallback: number) => trimmedMean(values) ?? fallback;
const means = (groups: Map<string, number[]>) => Object.fromEntries([...groups].map(([key, values]) => [key, mean(values, minimumGap)]));
const placements = (groups: Map<string, Placement[]>): Record<string, LearnedPlacement> =>
	Object.fromEntries(
		[...groups].map(([key, values]) => [
			key,
			{
				advanceGap: mean(
					values.map((value) => value.advanceGap),
					minimumGap
				),
				crossOffset: mean(
					values.map((value) => value.crossOffset),
					0
				),
				sampleCount: values.length
			}
		])
	);

interface CellGaps {
	char: string;
	kind: VowelKind;
	chars: ReturnType<typeof decomposeHangul>['chars'];
	upperGap: number;
	upper: Placement;
	lower?: { gap: number; placement: Placement };
}

const measured = cellMemo<CellGaps | null>();

/** The gaps one written syllable shows. Null when a jamo has no ink. */
function measureCell({ cell, session, assigned, cellX, cellY }: CompletedHangulCell, endpointStabilization: number): CellGaps | null {
	const boxes = assigned.map((group) => boundsFor(group, cellX, cellY, session.cellSize, endpointStabilization));
	if (boxes.some((box) => !box)) return null;
	const [initial, medial, final] = boxes as [Bounds, Bounds, Bounds?];
	const { kind, chars } = decomposeHangul(cell.char.codePointAt(0)!);
	const scaledGap = (gap: number) => Math.max(-minimumGap * 2, Math.min(300, (gap * 1000) / session.cellSize));

	/** A written jamo as the layout sees a placed one, in canvas pixels (y up). */
	const placed = (strokes: RawStroke[]): PlacedJamo => {
		const local = strokes.map((stroke) => ({ ...stroke, x: stroke.x - cellX, y: stroke.y - cellY }));
		const shape = normalizeRawStrokes(local, session.cellSize, endpointStabilization);
		const path = new opentype.Path();
		if (shape) appendShape(path, shape, { x: 0, y: 0, width: session.cellSize, height: session.cellSize }, true, session.cellSize / 1000);
		return { path, shape, scale: session.cellSize / CELL_UNITS };
	};
	// A compound vowel meets the initial with its horizontal part only.
	let medialAnchor = medial;
	if (kind === 'mixed') {
		const space = medialSpace(placed(assigned[1]).path)?.horizontal;
		if (space) medialAnchor = { left: space.x1, right: space.x2, top: session.cellSize - space.y2, bottom: session.cellSize - space.y1 };
	}
	const upperGap = scaledGap(kind === 'vertical' ? medial.left - initial.right : medialAnchor.top - initial.bottom);
	// Measured against the point the layout aligns the initial by, so the offset holds only what the writer does differently from that rule.
	const writtenVertical = () => {
		const shape = normalizeRawStrokes(
			assigned[0].map((stroke) => ({ ...stroke, x: stroke.x - cellX, y: stroke.y - cellY })),
			session.cellSize,
			endpointStabilization
		);
		const drop = shape ? initialBodyDrop(shape, session.cellSize / CELL_UNITS) : 0;
		return (((initial.top + initial.bottom - medial.top - medial.bottom) / 2 + drop) * 1000) / session.cellSize;
	};
	const upper: Placement = {
		advanceGap: upperGap,
		crossOffset: kind === 'vertical' ? writtenVertical() : ((medialAnchor.left + medialAnchor.right - (initial.left + initial.right)) * 500) / session.cellSize
	};
	if (!final) return { char: cell.char, kind, chars, upperGap, upper };

	const finalGap = scaledGap(final.top - Math.max(initial.bottom, medialAnchor.bottom));
	// Measured against the point the layout aims the final at, so the offset
	// holds only what the writer does differently from that rule.
	const written = placed(assigned[2]);
	return {
		char: cell.char,
		kind,
		chars,
		upperGap,
		upper,
		lower: {
			gap: finalGap,
			placement: {
				advanceGap: finalGap,
				crossOffset: ((finalAnchorX(written) - finalTargetX(kind, placed(assigned[0]), placed(assigned[1]))) * 1000) / session.cellSize
			}
		}
	};
}

/** Learn the free space the writer leaves between the jamo of a syllable. */
export function learnGaps(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1): GapProfile {
	const kinds: Record<VowelKind | 'final', number[]> = { vertical: [], horizontalUp: [], horizontalDown: [], mixed: [], final: [] };
	const contexts = new Map<string, number[]>();
	const medialContexts = new Map<string, number[]>();
	const finalContexts = new Map<string, number[]>();
	const initialMedialPairs = new Map<string, Placement[]>();
	const medialFinalPairs = new Map<string, Placement[]>();
	const initialMedialSyllables = new Map<string, Placement[]>();
	const medialFinalSyllables = new Map<string, Placement[]>();
	for (const item of completedHangulCells(sessions)) {
		const gaps = measured(item, endpointStabilization, () => measureCell(item, endpointStabilization));
		if (!gaps) continue;
		const { char, kind, chars, upperGap, upper, lower } = gaps;
		kinds[kind].push(upperGap);
		collect(contexts, gapContext(kind, Boolean(lower)), upperGap);
		collect(medialContexts, medialGapContext(chars.medial, Boolean(lower)), upperGap);
		collect(initialMedialPairs, gapPair(chars.initial, chars.medial, Boolean(lower)), upper);
		collect(initialMedialSyllables, char, upper);
		if (!lower) continue;
		kinds.final.push(lower.gap);
		collect(finalContexts, finalGapContext(kind, chars.final), lower.gap);
		collect(medialFinalPairs, finalGapPair(chars.medial, chars.final), lower.placement);
		collect(medialFinalSyllables, char, lower.placement);
	}
	return {
		vertical: mean(kinds.vertical, minimumGap),
		horizontalUp: mean(kinds.horizontalUp, minimumGap),
		horizontalDown: mean(kinds.horizontalDown, minimumGap),
		mixed: mean(kinds.mixed, minimumGap),
		final: mean(kinds.final, minimumGap),
		contexts: means(contexts),
		medialContexts: means(medialContexts),
		finalContexts: means(finalContexts),
		initialMedialPairs: placements(initialMedialPairs),
		medialFinalPairs: placements(medialFinalPairs),
		initialMedialSyllables: placements(initialMedialSyllables),
		medialFinalSyllables: placements(medialFinalSyllables)
	};
}
