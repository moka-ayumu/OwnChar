import { Store } from '@tanstack/react-store'
import { projectActions, projectStore } from './store'
import type { ProjectState } from './types'

const DATABASE = 'ownchar'
const STORE = 'project'
const KEY = 'current'

/** Whether the project in memory is on the device: `failed` when the browser blocks IndexedDB. */
export type SaveStatus = 'saved' | 'saving' | 'failed'

export const saveStatusStore = new Store<SaveStatus>('saved')
let saveTimer: number | undefined
let initialized = false

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readProject() {
  const database = await openDatabase()
  return new Promise<ProjectState | null>((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
    request.onsuccess = () => resolve((request.result as ProjectState | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

async function writeProject(project: ProjectState) {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(project, KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function clearPersistedProject() {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

/** Deletes the saved project from the device and empties the project in memory. */
export async function deletePersistedProject() {
  window.clearTimeout(saveTimer)
  projectActions.restoreProject(null)
  await clearPersistedProject()
  saveStatusStore.setState(() => 'saved')
}

export async function initializePersistence() {
  if (initialized) return
  initialized = true
  projectStore.subscribe(() => {
    const state = projectStore.state
    if (!state.hydrated) return
    window.clearTimeout(saveTimer)
    // An empty project holds nothing to keep, so it is never written back after a deletion.
    if (state.status === 'empty') return
    saveStatusStore.setState(() => 'saving')
    saveTimer = window.setTimeout(async () => {
      try {
        await writeProject(projectStore.state)
        saveStatusStore.setState(() => 'saved')
      } catch {
        // The app remains usable in-memory when private browsing blocks IndexedDB.
        saveStatusStore.setState(() => 'failed')
      }
    }, 450)
  })
  try {
    projectActions.restoreProject(await readProject())
  } catch {
    projectActions.restoreProject(null)
  }
}
