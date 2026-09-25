/// <reference lib="webworker" />

import { precomposeHangulRange, type PreparedCompositionContext } from '@/font/composer'
import type { GenerationRequest } from '@/types/project'

type ChunkRequest = { request: GenerationRequest; prepared: PreparedCompositionContext; start: number; end: number; id: number }
const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async (event: MessageEvent<ChunkRequest>) => {
  const { request, prepared, start, end, id } = event.data
  try {
    const records = await precomposeHangulRange(request, start, end, (completed) => {
      scope.postMessage({ type: 'progress', id, completed, total: end - start })
    }, prepared)
    scope.postMessage({ type: 'complete', id, records })
  } catch (error) {
    scope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : '한글 병렬 생성에 실패했습니다.' })
  }
}

export {}
