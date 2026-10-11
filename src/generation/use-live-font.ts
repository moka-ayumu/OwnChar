import { useEffect, useRef, useState } from 'react'
import { isHangulSyllable } from '@/font/hangul'
import type { CompositionSettings } from '@/font/settings'
import type { LiveFontEvent, LiveFontRequest, LiveFontSource } from './live-font.worker'

/**
 * The family name of a font that holds the syllables of `text`, composed
 * again in a worker whenever the settings change. Null until the first one is
 * ready. One request is in work at a time; of those that arrive meanwhile only
 * the latest is composed.
 */
export function useLiveFont(text: string, settings: CompositionSettings, { drawings, sessions, overrides, globalMetrics }: LiveFontSource) {
  const [family, setFamily] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)
  const queue = useRef<{ busy: boolean; next?: LiveFontRequest; id: number }>({ busy: false, id: 0 })
  const codePoints = [...new Set([...text].map((char) => char.codePointAt(0)!).filter(isHangulSyllable))].join(',')

  useEffect(() => {
    const instance = new Worker(new URL('./live-font.worker.ts', import.meta.url), { type: 'module' })
    const state = queue.current
    const faces: FontFace[] = []
    let disposed = false
    const finish = () => {
      if (disposed) return
      state.busy = false
      if (!state.next) return
      state.busy = true
      instance.postMessage(state.next)
      state.next = undefined
    }
    instance.onmessage = ({ data }: MessageEvent<LiveFontEvent>) => {
      if (data.type === 'error') { finish(); return }
      const next = new FontFace(`OwnCharLive${data.id}`, data.buffer)
      void next.load().then(() => {
        if (disposed) return
        document.fonts.add(next)
        setFamily(next.family)
        // The text is still drawn with the face before this one until the next render.
        faces.push(next)
        if (faces.length > 2) document.fonts.delete(faces.shift()!)
      }).catch(() => undefined).finally(finish)
    }
    instance.onerror = finish
    worker.current = instance
    return () => {
      disposed = true
      instance.terminate()
      worker.current = null
      state.busy = false
      state.next = undefined
      for (const face of faces) document.fonts.delete(face)
    }
  }, [])

  useEffect(() => {
    worker.current?.postMessage({ type: 'source', drawings, sessions, overrides, globalMetrics } satisfies LiveFontRequest)
  }, [drawings, sessions, overrides, globalMetrics])

  useEffect(() => {
    const state = queue.current
    state.id += 1
    const request: LiveFontRequest = { type: 'compose', id: state.id, settings, codePoints: codePoints ? codePoints.split(',').map(Number) : [] }
    if (state.busy) state.next = request
    else {
      state.busy = true
      worker.current?.postMessage(request)
    }
  }, [settings, codePoints, drawings, sessions, overrides, globalMetrics])

  return family
}
