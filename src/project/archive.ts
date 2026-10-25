import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { joinProject, splitProject, type SavedProject } from './saved-format';
import { projectActions } from './store';
import { SCHEMA_VERSION, type ProjectState } from './types';

export const ARCHIVE_EXTENSION = '.ownchar';

const PROJECT_ENTRY = 'project.json';
const FONT_ENTRY = 'font.otf';

/** Packs the project into a zip: the project as JSON and the generated font as a binary entry. */
export function createProjectArchive(project: ProjectState): Uint8Array {
	const saved = splitProject(project);
	const { hydrated, generation, ...meta } = saved.meta;
	void hydrated;
	void generation;
	const entries: Record<string, Uint8Array> = { [PROJECT_ENTRY]: strToU8(JSON.stringify({ ...saved, meta })) };
	if (project.generatedFont) entries[FONT_ENTRY] = new Uint8Array(project.generatedFont);
	return zipSync(entries);
}

/** Reads a project archive. Throws if the file is not an OwnChar archive of the current format. */
export function readProjectArchive(bytes: Uint8Array): ProjectState {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(bytes);
	} catch {
		throw new Error('OwnChar 프로젝트 파일이 아닙니다.');
	}
	if (!entries[PROJECT_ENTRY]) throw new Error('OwnChar 프로젝트 파일이 아닙니다.');
	const saved = JSON.parse(strFromU8(entries[PROJECT_ENTRY])) as {
		meta: Omit<SavedProject['meta'], 'hydrated' | 'generation'>;
		sessions: SavedProject['sessions'];
		drawings: SavedProject['drawings'];
		customGlyphs?: SavedProject['customGlyphs'];
	};
	if (saved.meta?.schemaVersion !== SCHEMA_VERSION) throw new Error('지원하지 않는 프로젝트 파일 형식입니다.');
	const font = entries[FONT_ENTRY];
	const { status } = saved.meta;
	return joinProject(
		{
			...saved,
			customGlyphs: saved.customGlyphs ?? {},
			meta: {
				...saved.meta,
				hydrated: true,
				generation: { progress: 0, message: '', error: null },
				status: status === 'generating' || status === 'error' ? (font ? 'ready' : 'writing') : status
			}
		},
		font ? font.slice().buffer : null
	);
}

export function downloadProjectArchive(project: ProjectState) {
	const bytes = createProjectArchive(project);
	const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = `${project.metadata.familyName || 'ownchar'}${ARCHIVE_EXTENSION}`;
	link.click();
	URL.revokeObjectURL(url);
}

export async function loadProjectArchive(file: File) {
	projectActions.restoreProject(readProjectArchive(new Uint8Array(await file.arrayBuffer())));
}
