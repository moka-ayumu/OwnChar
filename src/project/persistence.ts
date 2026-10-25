import { Store } from '@tanstack/react-store';
import { reportError } from '@/lib/telemetry';
import { joinProject, splitProject, type SavedMeta, type SavedProject } from './saved-format';
import { projectActions, projectStore } from './store';
import type { ProjectState } from './types';

const DATABASE = 'ownchar';
const DATABASE_VERSION = 2;
const STORE = 'records';
const OLD_STORE = 'project';
const META_KEY = 'meta';
const FONT_KEY = 'font';
const SESSION_PREFIX = 'session:';
const DRAWING_PREFIX = 'drawing:';
const CUSTOM_PREFIX = 'custom:';

/** Whether the project in memory is on the device: `failed` when the browser blocks IndexedDB. */
export type SaveStatus = 'saved' | 'saving' | 'failed';

export const saveStatusStore = new Store<SaveStatus>('saved');
let saveTimer: number | undefined;
let initialized = false;

/** What is on the device, by object identity: a record that is still the same object is not written again. */
interface Written {
	meta: SavedMeta | undefined;
	font: ArrayBuffer | null;
	sessions: SavedProject['sessions'];
	drawings: SavedProject['drawings'];
	customGlyphs: SavedProject['customGlyphs'];
}

let written: Written = { meta: undefined, font: null, sessions: {}, drawings: {}, customGlyphs: {} };

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (database.objectStoreNames.contains(OLD_STORE)) database.deleteObjectStore(OLD_STORE);
			if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

const asPromise = <T>(request: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

function shallowEqual(left: object, right: object) {
	const keys = Object.keys(left) as Array<keyof typeof left>;
	return keys.length === Object.keys(right).length && keys.every((key) => Object.is(left[key], right[key]));
}

async function readProject(): Promise<ProjectState | null> {
	const database = await openDatabase();
	const store = database.transaction(STORE, 'readonly').objectStore(STORE);
	const [keys, values] = await Promise.all([asPromise(store.getAllKeys()), asPromise(store.getAll())]);
	const saved: SavedProject = { meta: undefined as unknown as SavedMeta, sessions: {}, drawings: {}, customGlyphs: {} };
	let font: ArrayBuffer | null = null;
	keys.forEach((key, index) => {
		const name = String(key);
		if (name === META_KEY) saved.meta = values[index];
		else if (name === FONT_KEY) font = values[index];
		else if (name.startsWith(SESSION_PREFIX)) saved.sessions[name.slice(SESSION_PREFIX.length)] = values[index];
		else if (name.startsWith(DRAWING_PREFIX)) saved.drawings[name.slice(DRAWING_PREFIX.length)] = values[index];
		else if (name.startsWith(CUSTOM_PREFIX)) saved.customGlyphs[name.slice(CUSTOM_PREFIX.length)] = values[index];
	});
	if (!saved.meta) return null;
	written = { meta: saved.meta, font, sessions: saved.sessions, drawings: saved.drawings, customGlyphs: saved.customGlyphs };
	return joinProject(saved, font);
}

/** Writes only the records that are no longer the objects on the device, and removes the ones that are gone. */
async function writeProject(project: ProjectState) {
	const next = splitProject(project);
	const previous = written;
	const puts: Array<[string, unknown]> = [];
	const deletes: string[] = [];
	if (!previous.meta || !shallowEqual(previous.meta, next.meta)) puts.push([META_KEY, next.meta]);
	if (previous.font !== project.generatedFont) {
		if (project.generatedFont) puts.push([FONT_KEY, project.generatedFont]);
		else deletes.push(FONT_KEY);
	}
	for (const [prefix, before, after] of [
		[SESSION_PREFIX, previous.sessions, next.sessions],
		[DRAWING_PREFIX, previous.drawings, next.drawings],
		[CUSTOM_PREFIX, previous.customGlyphs, next.customGlyphs]
	] as const) {
		for (const [id, record] of Object.entries(after)) if (before[id] !== record) puts.push([prefix + id, record]);
		for (const id of Object.keys(before)) if (!(id in after)) deletes.push(prefix + id);
	}
	if (!puts.length && !deletes.length) return;
	const database = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(STORE, 'readwrite');
		const store = transaction.objectStore(STORE);
		for (const [key, value] of puts) store.put(value, key);
		for (const key of deletes) store.delete(key);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
	written = { meta: next.meta, font: project.generatedFont, sessions: next.sessions, drawings: next.drawings, customGlyphs: next.customGlyphs };
}

export async function clearPersistedProject() {
	const database = await openDatabase();
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(STORE, 'readwrite');
		transaction.objectStore(STORE).clear();
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
	written = { meta: undefined, font: null, sessions: {}, drawings: {}, customGlyphs: {} };
}

/** Deletes the saved project from the device and empties the project in memory. */
export async function deletePersistedProject() {
	window.clearTimeout(saveTimer);
	projectActions.restoreProject(null);
	await clearPersistedProject();
	saveStatusStore.setState(() => 'saved');
}

export async function initializePersistence() {
	if (initialized) return;
	initialized = true;
	projectStore.subscribe(() => {
		const state = projectStore.state;
		if (!state.hydrated) return;
		window.clearTimeout(saveTimer);
		// An empty project holds nothing to keep, so it is never written back after a deletion.
		if (state.status === 'empty') return;
		saveStatusStore.setState(() => 'saving');
		saveTimer = window.setTimeout(async () => {
			try {
				await writeProject(projectStore.state);
				saveStatusStore.setState(() => 'saved');
			} catch (error) {
				reportError('PROJECT_SAVE_FAILED', error);
				// The app remains usable in-memory when private browsing blocks IndexedDB.
				saveStatusStore.setState(() => 'failed');
			}
		}, 450);
	});
	try {
		projectActions.restoreProject(await readProject());
	} catch (error) {
		reportError('PROJECT_LOAD_FAILED', error);
		projectActions.restoreProject(null);
	}
}
