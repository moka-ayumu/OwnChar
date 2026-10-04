/// <reference lib="webworker" />

import { encodeHangulRange, hangulComposer, type PreparedCompositionContext } from './font-builder'
import { transferables, type EncodedGlyphs } from './otf-writer'
import type { GenerationRequest } from './request'

export interface ChunkRequest { request: GenerationRequest; prepared: PreparedCompositionContext; start: number; end: number }
export type ChunkEvent =
  | { type: 'progress'; completed: number }
  | { type: 'complete'; glyphs: EncodedGlyphs }
  | { type: 'error'; message: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (event: ChunkEvent, transfer: Transferable[] = []) => scope.postMessage(event, transfer)

scope.onmessage = (event: MessageEvent<ChunkRequest>) => {
  const { request, prepared, start, end } = event.data
  try {
    const glyphs = encodeHangulRange(request, start, end, hangulComposer(request, prepared), (completed) => post({ type: 'progress', completed }))
    post({ type: 'complete', glyphs }, transferables(glyphs))
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : '한글 병렬 생성에 실패했습니다.' })
  }
}
