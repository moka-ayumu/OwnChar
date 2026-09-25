import { projectActions, projectStore } from '@/store/project-store'
import type { ProjectState } from '@/types/project'

const DATABASE = 'ownchar'
const STORE = 'project'
const KEY = 'current'
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

export async function initializePersistence() {
  if (initialized) return
  initialized = true
  projectStore.subscribe(() => {
    const state = projectStore.state
    if (!state.hydrated) return
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(async () => {
      const savedAt = Date.now()
      try {
        await writeProject({ ...projectStore.state, lastSavedAt: savedAt })
      } catch {
        // The app remains usable in-memory when private browsing blocks IndexedDB.
      }
    }, 450)
  })
  try {
    projectActions.restoreProject(await readProject())
  } catch {
    projectActions.restoreProject(null)
  }
}
