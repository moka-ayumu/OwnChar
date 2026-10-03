/// <reference lib="webworker" />

import { precomposeHangulRange, type HangulGlyphRecord, type PreparedCompositionContext } from './font-builder'
import type { GenerationRequest } from './request'

export interface ChunkRequest { request: GenerationRequest; prepared: PreparedCompositionContext; start: number; end: number }
export type ChunkEvent =
  | { type: 'progress'; completed: number }
  | { type: 'complete'; records: HangulGlyphRecord[] }
  | { type: 'error'; message: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (event: ChunkEvent) => scope.postMessage(event)

scope.onmessage = async (event: MessageEvent<ChunkRequest>) => {
  const { request, prepared, start, end } = event.data
  try {
    const records = await precomposeHangulRange(request, start, end, (completed) => post({ type: 'progress', completed }), prepared)
    post({ type: 'complete', records })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : '한글 병렬 생성에 실패했습니다.' })
  }
}
