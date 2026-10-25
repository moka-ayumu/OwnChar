import { WRITING_EXERCISES, type WritingCell } from '@/collection/exercises';
import { cellOrigin, type WritingSessionRecord } from '@/collection/records';
import type { RawStroke } from '@/font/stroke/outline';

export interface CompletedHangulCell {
	cell: WritingCell;
	cellIndex: number;
	session: WritingSessionRecord;
	/** Strokes per capture slot, in canvas coordinates. */
	assigned: RawStroke[][];
	cellX: number;
	cellY: number;
}

/**
 * Every fully written syllable of the base Hangul sentences. A partly written
 * syllable must never teach spacing, size or proportion. A jamo is fully
 * written when it has its usual stroke count, or when the writer declared its
 * end. With every earlier end declared, the last jamo is fully written once a
 * later cell has strokes.
 */
export function completedHangulCells(sessions: Record<string, WritingSessionRecord>): CompletedHangulCell[] {
	const result: CompletedHangulCell[] = [];
	for (const exercise of WRITING_EXERCISES) {
		if (exercise.group !== 'hangul') continue;
		const session = sessions[exercise.id];
		if (!session) continue;
		const strokes = new Map(session.elements.filter((item) => !item.isDeleted).map((item) => [item.id, item]));
		const lastWritten = session.assignments.reduce((last, assignment) => Math.max(last, assignment.cellIndex), -1);
		exercise.cells.forEach((cell, cellIndex) => {
			if (cell.slots.length < 2) return;
			const assigned = cell.slots.map((_, slotIndex) =>
				session.assignments
					.filter((assignment) => assignment.cellIndex === cellIndex && assignment.slotIndex === slotIndex)
					.map((assignment) => strokes.get(assignment.elementId))
					.filter((stroke): stroke is RawStroke => Boolean(stroke))
			);
			const declared = new Set((session.boundaries[cellIndex] ?? []).map((boundary) => boundary.slotIndex));
			const last = cell.slots.length - 1;
			const written = (group: RawStroke[], index: number) => group.length >= cell.slots[index].expectedStrokes || (group.length > 0 && (declared.has(index) || (index === last && declared.size === last && cellIndex < lastWritten)));
			if (!assigned.every(written)) return;
			const origin = cellOrigin(cellIndex, session.columns, session.cellSize);
			result.push({ cell, cellIndex, session, assigned, cellX: origin.x, cellY: origin.y });
		});
	}
	return result;
}

/** Mean without the outer tenth on each side, once there are enough samples to have outliers. */
export function trimmedMean(values: number[]) {
	if (!values.length) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const trim = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
	const retained = sorted.slice(trim, sorted.length - trim);
	return retained.reduce((sum, value) => sum + value, 0) / retained.length;
}

/** Appends `value` to the list kept under `key`. */
export function collect<T>(map: Map<string, T[]>, key: string, value: T) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/** What was measured for each cell, kept while the strokes of the cell and its grid stay the same. */
export function cellMemo<T>() {
	const kept = new Map<string, { signature: string; value: T }>();
	return ({ session, cellIndex, assigned }: CompletedHangulCell, setting: number, measure: () => T): T => {
		const key = `${session.exerciseId}|${cellIndex}`;
		const signature = `${session.cellSize}|${session.columns}|${setting}|${assigned.map((group) => group.map((stroke) => `${stroke.id}:${stroke.version}`).join(',')).join(';')}`;
		const entry = kept.get(key);
		if (entry?.signature === signature) return entry.value;
		const value = measure();
		kept.set(key, { signature, value });
		return value;
	};
}
