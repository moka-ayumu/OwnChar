import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, FastForward, RotateCcw, X } from 'lucide-react'
import { customStamps } from '@/collection/custom-glyphs'
import { RailBrand } from '@/components/rail-brand'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/hint'
import { Progress } from '@/components/ui/progress'
import { BIND_LENGTH, BIND_STEP, buildFilm, DONE_STEP, drawFilm, filmLength, filmStep, FILM_NOTES, FILM_STEPS, lanesCue, LANES_STEP, liftLength, type FilmData, type LineTarget } from '@/features/generating/film'
import { reportError, trackEvent } from '@/lib/telemetry'
import { flow, LEAD_SENTENCE, LEAD_SIZE, prefersReducedMotion } from '@/lib/flow'
import { useFontFace } from '@/lib/use-font-face'
import { useProject } from '@/project/use-project'
import { projectActions, projectStore } from '@/project/store'
import type { GenerationEvent, GenerationRequest } from '@/generation/request'
import { buildGenerationInputs } from '@/generation/inputs'

export const Route = createFileRoute('/generate')({ component: GeneratePage })

/** How long the sentence may wait for the new font to register before the preview takes over without it. */
const FONT_WAIT = 4
/** Share of the syllables composed by the time the film reaches the lanes, when the film can be slowed that far. */
const LANES_SHARE = 0.88
/** The most the film is slowed to keep pace with composition. */
const MAX_STRETCH = 3

function GeneratePage() {
  const navigate = useNavigate()
  const generation = useProject((state) => state.generation)
  const buffer = useProject((state) => state.generatedFont)
  const revision = useProject((state) => state.fontRevision)
  const fontReady = useFontFace(buffer, revision)
  const workerRef = useRef<Worker | null>(null)
  const started = useRef(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const line = useRef<HTMLDivElement>(null)
  const steps = useRef<HTMLOListElement>(null)
  const film = useRef<FilmData | null>(null)
  const clock = useRef({ start: 0, time: 0, pace: 1, drawn: 0, shown: 0, lanes: [] as number[], skipped: false, bind: 0, lift: 0, left: false })
  // What the worker last reported, for the frame loop to read.
  const live = useRef({ complete: false, fontReady: false, lanes: undefined as number[] | undefined })
  const targets = useRef<LineTarget[] | null>(null)
  // Every generation plays the whole film, a regeneration too: composing takes its time either way.
  const [kind] = useState<'full' | 'none'>(() => prefersReducedMotion() ? 'none' : 'full')
  const [step, setStep] = useState(kind === 'full' ? 0 : LANES_STEP)
  const [complete, setComplete] = useState(false)
  const [played, setPlayed] = useState(kind === 'none')
  const finished = step === DONE_STEP || (complete && kind === 'none')

  const leave = useCallback(() => {
    if (clock.current.left) return
    clock.current.left = true
    void navigate({ to: '/preview', viewTransition: true })
  }, [navigate])

  const run = useCallback(() => {
    const state = projectStore.state
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../generation/font.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    projectActions.startGeneration()
    trackEvent('generation_started', { drawings: Object.keys(state.drawings).length, sessions: Object.keys(state.writingSessions).length })
    setComplete(false)
    live.current = { ...live.current, complete: false, lanes: undefined }

    worker.onmessage = (event: MessageEvent<GenerationEvent>) => {
      const message = event.data
      if (message.type === 'progress') {
        if (message.lanes) live.current.lanes = message.lanes
        projectActions.updateGenerationProgress(message.progress, message.message)
      }
      if (message.type === 'complete') {
        projectActions.completeGeneration(message.buffer, { metadata: state.metadata, globalMetrics: state.globalMetrics, compositionSettings: state.compositionSettings, glyphOverrides: state.glyphOverrides, customGlyphs: customStamps(state.customGlyphs) })
        worker.terminate()
        trackEvent('generation_completed')
        live.current.complete = true
        setComplete(true)
      }
      if (message.type === 'error') {
        reportError('FONT_BUILD_FAILED', new Error(message.message), { drawings: Object.keys(state.drawings).length, sessions: Object.keys(state.writingSessions).length })
        trackEvent('generation_failed')
        projectActions.failGeneration(message.message)
      }
      if (message.type === 'cancelled') {
        trackEvent('generation_cancelled')
        projectActions.cancelGeneration()
        void navigate({ to: '/write', viewTransition: true })
      }
    }
    worker.onerror = (event) => {
      reportError('FONT_WORKER_CRASHED', new Error(event.message))
      trackEvent('generation_failed')
      projectActions.failGeneration(event.message || '폰트 생성 worker를 실행하지 못했습니다.')
    }

    const request: GenerationRequest = {
      type: 'compose-font',
      ...buildGenerationInputs(state.drawings, state.writingSessions, state.compositionSettings),
      metadata: state.metadata,
      overrides: state.glyphOverrides,
      globalMetrics: state.globalMetrics,
      compositionSettings: state.compositionSettings,
      customGlyphs: state.customGlyphs,
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

  useEffect(() => { live.current.fontReady = fontReady }, [fontReady])

  // With no film to finish, the preview takes over as soon as the font exists.
  useEffect(() => {
    if (complete && (kind === 'none' || !film.current)) leave()
  }, [complete, kind, leave])

  // The film: one canvas, redrawn each frame from the clock and the worker's real progress.
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    /** Where each character of the preview sentence stands, relative to the canvas. */
    const measure = (): LineTarget[] | null => {
      const text = line.current?.firstChild
      const mark = line.current?.lastElementChild
      if (!text || !mark) return null
      const frame = element.getBoundingClientRect()
      const range = document.createRange()
      const boxes = [...LEAD_SENTENCE].map((_, index) => {
        range.setStart(text, index)
        range.setEnd(text, index + 1)
        return range.getBoundingClientRect()
      })
      // The mark stands on the baseline of the last line; a character on an earlier line is as much higher as its line is.
      const baseline = mark.getBoundingClientRect().bottom - frame.top
      const lastTop = boxes[boxes.length - 1].top
      return boxes.map((box) => ({ x: box.left - frame.left, baseline: baseline - (lastTop - box.top) }))
    }
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
      const now = performance.now()
      const length = filmLength(data, kind)
      const done = live.current.complete
      const overall = done ? 1 : Math.max(0, Math.min(1, (projectStore.state.generation.progress - 3) / 91))
      const passed = (now - (state.drawn || now)) / 1000
      // The steps on the specimens take the time composition takes: the film slows so the lanes open only when most syllables are composed.
      const lanesAt = lanesCue(data, kind)
      let pace = 1
      if (!done && overall > 0.02 && overall < LANES_SHARE && state.time < lanesAt) {
        const wait = (LANES_SHARE - overall) * (now - state.start) / 1000 / overall
        pace = Math.max(1 / MAX_STRETCH, Math.min(1, (lanesAt - state.time) / wait))
      }
      state.pace += (pace - state.pace) * (1 - Math.exp(-passed / 0.6))
      state.time = state.skipped ? length : state.time + passed * state.pace
      const time = state.time
      // Follows the real progress closely, whatever the frame rate.
      const follow = 1 - Math.exp(-passed / 0.12)
      state.drawn = now
      state.shown += (overall - state.shown) * follow
      state.lanes = (live.current.lanes ?? [overall]).map((share, lane) => {
        const shown = state.lanes[lane] ?? 0
        return shown + ((done ? 1 : share) - shown) * follow
      })
      if (time >= length) setPlayed(true)

      // Finished and played through: the blocks join, then the preview sentence leaves them.
      if (done && time >= length && kind !== 'none' && !state.bind) state.bind = now
      const bind = state.bind ? (now - state.bind) / 1000 : -1
      if (bind >= BIND_LENGTH && !state.lift) {
        if (!data.line.length || bind > BIND_LENGTH + FONT_WAIT) leave()
        else if (live.current.fontReady && (targets.current = measure())) state.lift = now
      }
      const lift = state.lift ? (now - state.lift) / 1000 : -1
      if (lift >= liftLength(data)) leave()
      setStep(lift >= 0 ? DONE_STEP : bind >= 0 ? BIND_STEP : filmStep(data, kind, time))
      drawFilm(context, width, height, dpr, data, { time, composed: state.shown, lanes: state.lanes, kind, bind, lift, targets: targets.current, em: LEAD_SIZE })
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [kind, leave])

  // The live step stays in view in a rail too short for the whole list.
  useEffect(() => {
    steps.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' })
  }, [step])

  const cancel = () => workerRef.current?.postMessage({ type: 'cancel' })
  const skip = () => { clock.current.skipped = true; setPlayed(true) }
  const percent = Math.round(generation.progress)

  return (
    <div className="flow">
      <aside className="rail">
        <RailBrand />
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">{finished ? '폰트 생성이 완료되었습니다' : '폰트를 생성하는 중입니다'}</h1>

        <ol ref={steps} className="step-list" aria-label="생성 단계">
          {FILM_STEPS.map((name, index) => (
            <li key={name} className={index === step ? 'now' : index < step ? 'done' : undefined} aria-current={index === step ? 'step' : undefined}>
              <Hint side="right" className="step-hint" label={FILM_NOTES[index]}>
                <span>{index < step ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}</span>
                <span>{name}</span>
              </Hint>
            </li>
          ))}
        </ol>

        <div className="pt-4">
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
        <canvas ref={canvas} className="film" aria-hidden="true" />
        {/* The preview's own layout, unseen: the sentence is measured here so its glyphs land where the preview shows them. */}
        <div className="preview-stage film-arrival" aria-hidden="true">
          <div className="h-6" />
          <div className="type-stack">
            <div ref={line} className="font-preview type-overlay" style={{ fontFamily: 'OwnCharPreview', fontSize: LEAD_SIZE, lineHeight: 1.25 }}>{LEAD_SENTENCE}<i className="film-baseline" /></div>
          </div>
        </div>
        {generation.error && (
          <div className="film-error" role="alert">
            <p className="text-base font-bold text-danger">폰트 생성에 실패했습니다</p>
            <p className="mt-1 text-sm leading-6 text-ink-2">{generation.error}</p>
            <Button className="mt-4" onClick={run}><RotateCcw className="size-4" /> 다시 시도</Button>
          </div>
        )}
      </section>
    </div>
  )
}
