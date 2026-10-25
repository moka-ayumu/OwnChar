import { useStore } from '@tanstack/react-store';
import { saveStatusStore } from './persistence';
import { projectStore } from './store';
import type { ProjectState } from './types';

export function useProject<T>(selector: (state: ProjectState) => T) {
	return useStore(projectStore, selector);
}

export function useSaveStatus() {
	return useStore(saveStatusStore);
}
