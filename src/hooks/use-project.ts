import { useStore } from '@tanstack/react-store'
import { projectStore } from '@/store/project-store'
import type { ProjectState } from '@/types/project'

export function useProject<T>(selector: (state: ProjectState) => T) {
  return useStore(projectStore, selector)
}
