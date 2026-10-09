import { existsSync, readFileSync } from 'node:fs'

const sampleProject = new URL('../../src/dev/sample-project.json', import.meta.url)

/** Reads the sample project. Exits with a message if the file is missing. */
export function loadProject() {
  if (!existsSync(sampleProject)) {
    console.error('src/dev/sample-project.json is missing. Run tools/project/export-project.js in the browser console and save the file there.')
    process.exit(1)
  }
  const { meta, sessions, drawings } = JSON.parse(readFileSync(sampleProject, 'utf8'))
  return { ...meta, writingSessions: sessions, drawings }
}
