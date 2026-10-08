import { describe, expect, it } from 'vitest'
import { createProjectArchive, readProjectArchive } from '@/project/archive'
import { projectActions, projectStore } from '@/project/store'

describe('project archive', () => {
  it('restores the project and the generated font from an archive', () => {
    projectActions.startProject()
    const font = new Uint8Array([0, 1, 2, 255]).buffer
    const project = { ...projectStore.state, status: 'ready' as const, generatedFont: font, fontRevision: 3 }
    const restored = readProjectArchive(createProjectArchive(project))
    expect(restored.fontRevision).toBe(3)
    expect(restored.status).toBe('ready')
    expect(Array.from(new Uint8Array(restored.generatedFont!))).toEqual([0, 1, 2, 255])
  })

  it('rejects a file that is not an archive', () => {
    expect(() => readProjectArchive(new Uint8Array([1, 2, 3]))).toThrow()
  })
})
