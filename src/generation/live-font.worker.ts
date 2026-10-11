/// <reference lib="webworker" />

import type { DrawingRecord, WritingSessionRecord } from '@/collection/records'
import type { NormalizedShape } from '@/font/geometry/shape'
import { visualCalibrationScale } from '@/font/glyphs/calibration'
import type { CompositionSettings } from '@/font/settings'
import { composeSubsetFont, encodeBaseBlock, hangulComposeOptions, hangulComposer, withSizeTargets, type HangulCompositionInputs, type HangulSource } from './font-builder'
import { buildGenerationInputs, shapesFromRequestDrawings } from './inputs'
import type { EncodedGlyphs } from './otf-writer'
import type { GenerationRequest } from './request'

export type LiveFontSource = Pick<GenerationRequest, 'overrides' | 'globalMetrics'> & {
  drawings: Record<string, DrawingRecord>
  sessions: Record<string, WritingSessionRecord>
}

export type LiveFontRequest =
  | ({ type: 'source' } & LiveFontSource)
  | { type: 'compose'; id: number; settings: CompositionSettings; codePoints: number[] }

export type LiveFontEvent =
  | { type: 'font'; id: number; buffer: ArrayBuffer }
  | { type: 'error'; id: number }

const scope = self as unknown as DedicatedWorkerGlobalScope
const metadata = { familyName: 'OwnCharLive', styleName: 'Regular', designer: '', version: '1.0' }

let source: LiveFontSource | undefined
/** What is learned from the handwriting: it changes with the source and the stroke conditioning only. */
let learned: { stabilization: number; inputs: ReturnType<typeof buildGenerationInputs>; shapes: Map<string, NormalizedShape> } | undefined
/** What no size dial changes: the calibration and the base glyphs. */
let fixed: { key: string; visualScale: number; base?: EncodedGlyphs } | undefined
/** The syllables already composed with the latest settings. */
let composed: { key: string; glyphs: Map<number, ReturnType<HangulSource>> } | undefined

function compose(settings: CompositionSettings, codePoints: number[]) {
  if (!source) throw new Error('no source')
  if (!learned || learned.stabilization !== settings.endpointStabilization) {
    const inputs = buildGenerationInputs(source.drawings, source.sessions, settings)
    learned = { stabilization: settings.endpointStabilization, inputs, shapes: shapesFromRequestDrawings(inputs.drawings, settings) }
    fixed = composed = undefined
  }
  const request: GenerationRequest = { type: 'compose-font', ...learned.inputs, metadata, overrides: source.overrides, globalMetrics: source.globalMetrics, compositionSettings: settings }
  const { shapes } = learned
  const fixedKey = JSON.stringify({ ...settings, initialNormalization: 0, medialNormalization: 0, finalNormalization: 0, widthNormalization: 0 })
  if (fixed?.key !== fixedKey) fixed = { key: fixedKey, visualScale: visualCalibrationScale(shapes, settings, hangulComposeOptions(request)) }
  const prepared = { shapes, visualScale: fixed.visualScale, sizeTargets: withSizeTargets<HangulCompositionInputs>(shapes, request).sizeTargets }
  fixed.base ??= encodeBaseBlock(request, prepared)
  const key = JSON.stringify(settings)
  if (composed?.key !== key) composed = { key, glyphs: new Map() }
  const { glyphs } = composed
  const composer = hangulComposer(request, prepared)
  return composeSubsetFont(request, fixed.base, codePoints, (codePoint) => {
    let commands = glyphs.get(codePoint)
    if (!commands) glyphs.set(codePoint, commands = composer(codePoint))
    // Metrics and overrides move the outline they are given.
    return structuredClone(commands)
  })
}

scope.onmessage = ({ data }: MessageEvent<LiveFontRequest>) => {
  if (data.type === 'source') {
    source = data
    learned = fixed = composed = undefined
    return
  }
  try {
    const buffer = compose(data.settings, data.codePoints)
    scope.postMessage({ type: 'font', id: data.id, buffer } satisfies LiveFontEvent, [buffer])
  } catch {
    scope.postMessage({ type: 'error', id: data.id } satisfies LiveFontEvent)
  }
}
