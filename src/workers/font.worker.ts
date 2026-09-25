/// <reference lib="webworker" />

import { composeFont, prepareCompositionContext, type HangulGlyphRecord, type PreparedCompositionContext } from '@/font/composer'
import type { FontWorkerRequest, GenerationEvent } from '@/types/project'

const worker = self as unknown as DedicatedWorkerGlobalScope
let cancelled = false
let children: Worker[] = []

async function parallelHangul(request: Extract<FontWorkerRequest, { type: 'compose-font' }>, prepared: PreparedCompositionContext) {
  const available = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency ?? 4
  const count = Math.min(4, Math.max(1, available - 1))
  if (count === 1) return undefined
  const completed = new Map<number, number>()
  const chunks = Array.from({ length: count }, (_, id) => {
    const initialStart = Math.floor(19 * id / count)
    const initialEnd = Math.floor(19 * (id + 1) / count)
    return { id, start: initialStart * 588, end: initialEnd * 588 }
  })
  const results = await Promise.all(chunks.map((chunk) => new Promise<HangulGlyphRecord[]>((resolve, reject) => {
    const child = new Worker(new URL('./font-chunk.worker.ts', import.meta.url), { type: 'module' })
    children.push(child)
    child.onmessage = (message: MessageEvent<{ type: string; completed?: number; records?: HangulGlyphRecord[]; message?: string }>) => {
      if (message.data.type === 'progress') {
        completed.set(chunk.id, message.data.completed ?? 0)
        const done = [...completed.values()].reduce((sum, value) => sum + value, 0)
        worker.postMessage({ type: 'progress', stage: 'hangul', progress: 3 + Math.round(done / 11_172 * 91), message: `${done.toLocaleString()} / 11,172 글자 조합 중` } satisfies GenerationEvent)
      } else if (message.data.type === 'complete') {
        child.terminate(); resolve(message.data.records ?? [])
      } else if (message.data.type === 'error') {
        child.terminate(); reject(new Error(message.data.message))
      }
    }
    child.onerror = (error) => { child.terminate(); reject(new Error(error.message)) }
    child.postMessage({ request, prepared, ...chunk })
  })))
  children = []
  return new Map(results.flat().map((record) => [record.codePoint, record.commands]))
}

worker.onmessage = async (event: MessageEvent<FontWorkerRequest>) => {
  if (event.data.type === 'cancel') {
    cancelled = true
    children.forEach((child) => child.terminate())
    children = []
    return
  }

  cancelled = false
  try {
    const preparedContext = prepareCompositionContext(event.data)
    let precomposedHangul: Map<number, import('opentype.js').Path['commands']> | undefined
    try {
      precomposedHangul = await parallelHangul(event.data, preparedContext)
    } catch {
      children.forEach((child) => child.terminate())
      children = []
    }
    if (cancelled) throw new DOMException('Generation cancelled', 'AbortError')
    const result = await composeFont(event.data, {
      cancelled: () => cancelled,
      progress: (stage, progress, message) => {
        worker.postMessage({ type: 'progress', stage, progress, message } satisfies GenerationEvent)
      },
      yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
      precomposedHangul,
      preparedContext,
    })
    if (cancelled) {
      worker.postMessage({ type: 'cancelled' } satisfies GenerationEvent)
      return
    }
    worker.postMessage(
      { type: 'complete', buffer: result.buffer, glyphCount: result.glyphCount } satisfies GenerationEvent,
      [result.buffer],
    )
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      worker.postMessage({ type: 'cancelled' } satisfies GenerationEvent)
      return
    }
    worker.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
    } satisfies GenerationEvent)
  }
}

export {}
