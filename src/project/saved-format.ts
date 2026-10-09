import type { DrawingRecord, WritingSessionRecord } from '@/collection/records'
import type { ProjectState } from './types'

/** Everything about a project except its handwriting and the generated font, which are saved apart. */
export type SavedMeta = Omit<ProjectState, 'drawings' | 'writingSessions' | 'generatedFont'>

/**
 * The saved project: small settings, one record per sentence and one per
 * drawing. Each record is stored on its own, so a change writes only the
 * records it touched.
 */
export interface SavedProject {
  meta: SavedMeta
  sessions: Record<string, WritingSessionRecord>
  drawings: Record<string, DrawingRecord>
}

export function splitProject(project: ProjectState): SavedProject {
  const { drawings, writingSessions, generatedFont, ...meta } = project
  void generatedFont
  return { meta, sessions: writingSessions, drawings }
}

export function joinProject({ meta, sessions, drawings }: SavedProject, generatedFont: ArrayBuffer | null): ProjectState {
  return { ...meta, writingSessions: sessions, drawings, generatedFont }
}
