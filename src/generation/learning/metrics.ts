import type { WritingSessionRecord } from '@/collection/records';
import { clamp } from '@/font/geometry/path-ops';
import { DEFAULT_HANGUL_HEIGHT, medianHeight } from '@/font/metrics';
import { penDiameter, strokePolygon } from '@/font/stroke/outline';
import { cellMemo, completedHangulCells, type CompletedHangulCell } from './samples';

interface CellMetrics {
	height: number;
	size: number;
	center: number;
}

const measured = cellMemo<CellMetrics | null>();

function measureCell({ session, assigned, cellY }: CompletedHangulCell, endpointStabilization: number): CellMetrics | null {
	const points = assigned.flat().flatMap((stroke) =>
		strokePolygon(
			stroke.points.map(([x, y]) => [stroke.x + x, stroke.y + y]),
			stroke.pressures,
			penDiameter(stroke.strokeWidth, session.cellSize),
			true,
			endpointStabilization
		)
	);
	if (!points.length) return null;
	const xs = points.map((point) => point[0]);
	const ys = points.map((point) => point[1]);
	const top = Math.min(...ys);
	const bottom = Math.max(...ys);
	const height = ((bottom - top) * 1000) / session.cellSize;
	if (height <= 200 || height >= 1000) return null;
	return {
		height,
		size: Math.sqrt((height * (Math.max(...xs) - Math.min(...xs)) * 1000) / session.cellSize),
		center: 1000 - (((bottom + top) / 2 - cellY) * 1000) / session.cellSize
	};
}

/** The ink height, size and vertical centre the writer gives a whole syllable, in font units. */
export function learnHangulMetrics(sessions: Record<string, WritingSessionRecord>, endpointStabilization = 1) {
	const heights: number[] = [];
	const sizes: number[] = [];
	const centers: number[] = [];
	for (const cell of completedHangulCells(sessions)) {
		const metrics = measured(cell, endpointStabilization, () => measureCell(cell, endpointStabilization));
		if (!metrics) continue;
		heights.push(metrics.height);
		sizes.push(metrics.size);
		centers.push(metrics.center);
	}
	const height = medianHeight(heights, DEFAULT_HANGUL_HEIGHT);
	const hangulTargetHeight = clamp(height, 520, 850);
	return {
		hangulTargetHeight,
		hangulTargetSize: (hangulTargetHeight * medianHeight(sizes, height)) / height,
		hangulWrittenHeight: height,
		hangulWrittenSize: medianHeight(sizes, height),
		hangulTargetCenter: clamp(medianHeight(centers, 500), 350, 650)
	};
}
