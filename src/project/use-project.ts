import { useStore } from '@tanstack/react-store'
import { projectStore } from './store'
import type { ProjectState } from './types'

export function useProject<T>(selector: (state: ProjectState) => T) {
  return useStore(projectStore, selector)
}
