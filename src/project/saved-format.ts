import type { CustomGlyph } from '@/collection/custom-glyphs';
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records';
import type { ProjectState } from './types';

/** Everything about a project except its handwriting and the generated font, which are saved apart. */
export type SavedMeta = Omit<ProjectState, 'drawings' | 'writingSessions' | 'customGlyphs' | 'generatedFont'>;

/**
 * The saved project: small settings, one record per sentence, one per
 * drawing and one per glyph drawn whole. Each record is stored on its own,
 * so a change writes only the records it touched.
 */
export interface SavedProject {
	meta: SavedMeta;
	sessions: Record<string, WritingSessionRecord>;
	drawings: Record<string, DrawingRecord>;
	customGlyphs: Record<string, CustomGlyph>;
}

export function splitProject(project: ProjectState): SavedProject {
	const { drawings, writingSessions, customGlyphs, generatedFont, ...meta } = project;
	void generatedFont;
	return { meta, sessions: writingSessions, drawings, customGlyphs };
}

export function joinProject({ meta, sessions, drawings, customGlyphs }: SavedProject, generatedFont: ArrayBuffer | null): ProjectState {
	return { ...meta, writingSessions: sessions, drawings, customGlyphs, generatedFont };
}
