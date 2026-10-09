import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const outDir = new URL('../out/', import.meta.url)

/** Returns the URL of a file in tools/out. */
export const outUrl = (name) => new URL(name, outDir)

/** Writes a file in tools/out and creates the directory if needed. */
export function writeOut(name, text) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(outUrl(name), text)
}

/** Reads a JSON file from tools/out. */
export const readOutJson = (name) => JSON.parse(readFileSync(outUrl(name), 'utf8'))
