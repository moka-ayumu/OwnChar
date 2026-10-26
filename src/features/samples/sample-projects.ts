import { WRITING_EXERCISES } from '@/collection/exercises';
import { assignStrokes, captureRecords } from '@/features/writing/stroke-assignment';
import type { JamoBoundary } from '@/collection/records';
import type { StoredCellGuide } from '@/font/guides';
import type { RawStroke } from '@/font/stroke/outline';
import { clearPersistedProject } from '@/project/persistence';
import { projectActions, projectStore } from '@/project/store';

/** The strokes of one sentence of an example handwriting, on the grid they were made for. */
export interface SampleSession {
	exerciseId: string;
	cellSize: number;
	columns: number;
	elements: RawStroke[];
	/** Where a jamo written with another stroke count than usual ends, by cell. */
	boundaries: Record<number, JamoBoundary[]>;
}

const files = import.meta.glob<{ sessions: SampleSession[] }>('./example.json', { import: 'default' });

/** The strokes of one sentence of the example handwriting, or null when it has none. */
export async function loadSampleSession(exerciseId: string) {
	const { sessions } = await files['./example.json']();
	return sessions.find((session) => session.exerciseId === exerciseId) ?? null;
}

/** Replaces the project with the example handwriting. Its strokes go through the same save path as written strokes. */
export async function loadSampleProject() {
	const { sessions } = await files['./example.json']();
	await clearPersistedProject();
	projectActions.startProject();
	for (const { exerciseId, cellSize, columns, elements, boundaries } of sessions) {
		const exercise = WRITING_EXERCISES.find((item) => item.id === exerciseId);
		if (!exercise) continue;
		const state = projectStore.state;
		const grid = { cellSize, columns };
		const assigned = assignStrokes(elements, grid, exercise, state.drawings, boundaries, { mode: state.guideMode, pinned: {} });
		const guides: Record<number, StoredCellGuide> = {};
		for (const { cellIndex } of assigned.assignments) guides[cellIndex] = { roles: {}, placeholders: {}, bands: {} };
		projectActions.saveSentenceCapture(
			{
				exerciseId,
				text: exercise.text,
				elements,
				assignments: assigned.assignments,
				boundaries: assigned.boundaries,
				cellSize,
				columns,
				updatedAt: Date.now(),
				guides
			},
			captureRecords(assigned.groups, grid, exerciseId, state.compositionSettings.endpointStabilization)
		);
	}
}
