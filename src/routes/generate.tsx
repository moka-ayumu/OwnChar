import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, FastForward, RotateCcw, X } from 'lucide-react'
import { RailBrand } from '@/components/rail-brand'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { buildFilm, drawFilm, filmLength, filmStep, FILM_NOTES, FILM_STEPS, FINISH_STEP, GRID_STEP, type FilmData } from '@/features/generating/film'
import { flow, prefersReducedMotion } from '@/lib/flow'
import { useFontFace } from '@/lib/use-font-face'
import { useProject } from '@/project/use-project'
import { projectActions, projectStore } from '@/project/store'
import type { GenerationEvent, GenerationRequest } from '@/generation/request'
import { buildGenerationInputs } from '@/generation/inputs'

export const Route = createFileRoute('/generate')({ component: GeneratePage })

/** The first character of the sentence the preview opens on. */
const LEAD_CHAR = '오'
/** How long the finished lead glyph is held before the preview takes over. */
const LEAD_HOLD = 700

function GeneratePage() {
  const navigate = useNavigate()
  const generation = useProject((state) => state.generation)
  const buffer = useProject((state) => state.generatedFont)
  const revision = useProject((state) => state.fontRevision)
  const fontReady = useFontFace(buffer, revision)
  const workerRef = useRef<Worker | null>(null)
  const started = useRef(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const film = useRef<FilmData | null>(null)
  const clock = useRef({ start: 0, shown: 0, drawn: 0, skipped: false })
  // A font that already exists is being regenerated, which plays the short film.
  const [kind] = useState<'full' | 'short' | 'none'>(() => prefersReducedMotion() ? 'none' : projectStore.state.generatedFont ? 'short' : 'full')
  const [filmAt, setStep] = useState(kind === 'full' ? 0 : kind === 'short' ? 5 : GRID_STEP)
  const [complete, setComplete] = useState(false)
  const [played, setPlayed] = useState(kind === 'none')
  const finishing = complete && played
  const step = finishing ? FINISH_STEP : filmAt

  const run = useCallback(() => {
    const state = projectStore.state
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../generation/font.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    projectActions.startGeneration()
    setComplete(false)

    worker.onmessage = (event: MessageEvent<GenerationEvent>) => {
      const message = event.data
      if (message.type === 'progress') projectActions.updateGenerationProgress(message.progress, message.message)
      if (message.type === 'complete') {
        projectActions.completeGeneration(message.buffer)
        worker.terminate()
        setComplete(true)
      }
      if (message.type === 'error') projectActions.failGeneration(message.message)
      if (message.type === 'cancelled') {
        projectActions.cancelGeneration()
        void navigate({ to: '/write', viewTransition: true })
      }
    }
    worker.onerror = (event) => projectActions.failGeneration(event.message || '폰트 생성 worker를 실행하지 못했습니다.')

    const request: GenerationRequest = {
      type: 'compose-font',
      ...buildGenerationInputs(state.drawings, state.writingSessions, state.compositionSettings),
      metadata: state.metadata,
      overrides: state.glyphOverrides,
      globalMetrics: state.globalMetrics,
      compositionSettings: state.compositionSettings,
    }
    worker.postMessage(request)
  }, [navigate])

  useEffect(() => {
    if (!started.current) {
      started.current = true
      run()
      try {
        film.current = buildFilm(projectStore.state, flow.takeOrigin())
      } catch {
        // Without the film the page still shows the steps and the progress.
        film.current = null
      }
      clock.current.start = performance.now()
    }
    return () => workerRef.current?.terminate()
  }, [run])

  // The film: one canvas, redrawn each frame from the clock and the worker's real progress.
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const data = film.current
      if (!data) return
      const dpr = window.devicePixelRatio || 1
      const { clientWidth: width, clientHeight: height } = element
      if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
        element.width = Math.round(width * dpr)
        element.height = Math.round(height * dpr)
      }
      const state = clock.current
      const length = filmLength(data, kind)
      const time = state.skipped ? length : (performance.now() - state.start) / 1000
      const target = Math.max(0, Math.min(1, (projectStore.state.generation.progress - 3) / 91))
      // Follows the real progress closely, whatever the frame rate.
      const now = performance.now()
      state.shown += (target - state.shown) * (1 - Math.exp(-(now - (state.drawn || now)) / 120))
      state.drawn = now
      const current = filmStep(data, kind, time)
      setStep(current)
      if (time >= length) setPlayed(true)
      drawFilm(context, width, height, dpr, data, { time, composed: state.shown, kind, finishing: element.dataset.finishing === 'true' })
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [kind])

  // Finished and played through: hold the first glyph of the preview sentence, then hand over.
  useEffect(() => {
    if (!finishing) return
    const hold = kind === 'none' ? 0 : LEAD_HOLD
    // The glyph is shown once the new font is registered; a font that never registers does not hold the page.
    const timer = window.setTimeout(() => {
      flow.finishGeneration()
      void navigate({ to: '/preview', viewTransition: true })
    }, fontReady ? hold : hold + 4000)
    return () => window.clearTimeout(timer)
  }, [finishing, fontReady, kind, navigate])

  const cancel = () => workerRef.current?.postMessage({ type: 'cancel' })
  const skip = () => { clock.current.skipped = true; setPlayed(true) }
  const percent = Math.round(generation.progress)

  return (
    <div className="flow">
      <aside className="rail">
        <RailBrand />
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">{finishing ? '폰트가 완성됐어요' : '폰트를 만들고 있어요'}</h1>
        <p className="rail-note mt-2 min-h-10" aria-live="polite">{FILM_NOTES[step]}</p>

        <ol className="step-list mt-5" aria-label="생성 단계">
          {FILM_STEPS.map((name, index) => (
            <li key={name} className={index === step ? 'now' : index < step ? 'done' : undefined} aria-current={index === step ? 'step' : undefined}>
              <span>{index < step ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}</span>
              <span>{name}</span>
            </li>
          ))}
        </ol>

        <div className="mt-auto pt-6">
          <div className="flex items-end justify-between"><span className="rail-label">진행률</span><span className="rail-figure">{percent}<small>%</small></span></div>
          <Progress className="mt-3" value={generation.progress} />
          <p className="rail-note tnum mt-2 min-h-5">{generation.message || '글자 형태를 정리하는 중…'}</p>
          <div className="mt-3 grid gap-2">
            {!generation.error && kind !== 'none' && <Button className={played ? 'invisible' : undefined} variant="secondary" onClick={skip}><FastForward className="size-4" /> 건너뛰기</Button>}
            {!generation.error && <Button className="mt-2" variant="ghost" disabled={complete} onClick={cancel}><X className="size-4" /> 생성 취소</Button>}
          </div>
        </div>
      </aside>

      <section className="stage">
        <canvas ref={canvas} className="film" aria-hidden="true" data-finishing={finishing} />
        {finishing && fontReady && !generation.error && <span className="film-lead" aria-hidden="true" style={{ fontSize: 'min(26vh, 22vw, 230px)' }}>{LEAD_CHAR}</span>}
        {generation.error && (
          <div className="film-error" role="alert">
            <p className="text-base font-bold text-danger">생성 중 문제가 발생했습니다</p>
            <p className="mt-1 text-sm leading-6 text-ink-2">{generation.error}</p>
            <Button className="mt-4" onClick={run}><RotateCcw className="size-4" /> 다시 시도</Button>
          </div>
        )}
      </section>
    </div>
  )
}
