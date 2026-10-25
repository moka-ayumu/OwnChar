import { describe, expect, test } from 'vitest';
import { selectDrawings } from '@/collection/drawing-selection';
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records';
import { line, penStroke, ring } from './helpers';

function drawing(promptId: string, exerciseId: string, cellIndex: number, strokes: ReturnType<typeof penStroke>[], updatedAt = 1): DrawingRecord {
	return { promptId, codePoint: 0x3147, elements: strokes, paths: [], previewSvg: `${exerciseId}:${cellIndex}:${updatedAt}`, updatedAt, capture: { exerciseId, cellIndex, slotIndex: 0 } };
}

function session(exerciseId: string, captures: DrawingRecord[]): WritingSessionRecord {
	return { exerciseId, text: '', elements: [], assignments: [], boundaries: {}, cellSize: 148, columns: 5, updatedAt: 1, guides: {}, captures };
}

const smooth = () => [
	penStroke(
		's',
		40,
		40,
		ring.map(([x, y]) => [x * 1.5, y * 1.5])
	)
];
const shaky = () => [
	penStroke('z', 40, 40, [
		[0, 0],
		[10, 6],
		[20, -6],
		[30, 6],
		[40, -6],
		[50, 6],
		[60, -6],
		[70, 6]
	])
];
const tiny = () => [penStroke('t', 40, 40, line([0, 0], [8, 1], 1))];

describe('drawing selection', () => {
	test('the steadier, fuller drawing of a jamo is the one used, and the other is kept', () => {
		const sessions = {
			a: session('a', [drawing('initial-0-12615', 'a', 0, shaky())]),
			b: session('b', [drawing('initial-0-12615', 'b', 3, smooth())]),
			c: session('c', [drawing('initial-0-12615', 'c', 1, tiny())])
		};
		const drawings = selectDrawings(sessions, {});
		expect(drawings['initial-0-12615'].capture.exerciseId).toBe('b');
		expect(sessions.a.captures).toHaveLength(1);
	});

	test('equal drawings keep the one in use, and the standalone consonant follows it', () => {
		const first = drawing('initial-0-12615', 'a', 0, smooth(), 1);
		const second = drawing('initial-0-12615', 'b', 0, smooth(), 2);
		const previous = selectDrawings({ a: session('a', [first]) }, {});
		const drawings = selectDrawings({ a: session('a', [first]), b: session('b', [second]) }, previous);
		expect(drawings['initial-0-12615']).toBe(first);
		expect(drawings['consonant-12615'].derivedFromPromptId).toBe('initial-0-12615');
	});
});
