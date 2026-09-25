import { useCallback, useEffect, useRef } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LoaderCircle, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useProject } from '@/hooks/use-project'
import { projectActions, projectStore } from '@/store/project-store'
import type { GenerationEvent, GenerationRequest } from '@/types/project'
import type { RawStroke } from '@/font/stroke-outline'
import { learnGaps } from '@/font/gap-learning'
import { learnHangulCenter, learnHangulHeight } from '@/font/hangul-height'

export const Route = createFileRoute('/generate')({ component: GeneratePage })

function GeneratePage() {
  const navigate = useNavigate()
  const generation = useProject((state) => state.generation)
  const workerRef = useRef<Worker | null>(null)
  const started = useRef(false)

  const run = useCallback(() => {
    const state = projectStore.state
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../workers/font.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    projectActions.startGeneration()

    worker.onmessage = (event: MessageEvent<GenerationEvent>) => {
      const message = event.data
      if (message.type === 'progress') projectActions.updateGenerationProgress(message.stage, message.progress, message.message)
      if (message.type === 'complete') {
        projectActions.completeGeneration(message.buffer)
        worker.terminate()
        void navigate({ to: '/preview' })
      }
      if (message.type === 'error') projectActions.failGeneration(message.message)
      if (message.type === 'cancelled') {
        projectActions.cancelGeneration()
        void navigate({ to: '/write' })
      }
    }
    worker.onerror = (event) => projectActions.failGeneration(event.message || '폰트 생성 worker를 실행하지 못했습니다.')

    const request: GenerationRequest = {
      type: 'compose-font',
      drawings: Object.fromEntries(Object.entries(state.drawings).map(([promptId, drawing]) => [
        promptId,
        drawing.derivedFromPromptId && state.drawings[drawing.derivedFromPromptId]
          ? { sourcePromptId: drawing.derivedFromPromptId }
          : {
            paths: drawing.paths,
            elements: (drawing.elements as unknown as RawStroke[]).map((element) => {
              const capture = drawing.capture
              const session = capture ? state.writingSessions[capture.exerciseId] : undefined
              const size = session?.cellSize ?? 148
              const columns = session?.columns ?? 1
              const offsetX = capture ? (capture.cellIndex % columns) * size : 0
              const offsetY = capture ? Math.floor(capture.cellIndex / columns) * size : 0
              return { ...element, x: element.x - offsetX, y: element.y - offsetY }
            }),
            cellSize: drawing.capture
              ? state.writingSessions[drawing.capture.exerciseId]?.cellSize ?? 148
              : undefined,
            sourceCellId: drawing.capture ? `${drawing.capture.exerciseId}:${drawing.capture.cellIndex}` : undefined,
          },
      ])),
      metadata: state.metadata,
      overrides: state.glyphOverrides,
      globalMetrics: state.globalMetrics,
      compositionSettings: state.compositionSettings,
      gaps: learnGaps(state.writingSessions, state.compositionSettings.endpointStabilization),
      hangulTargetHeight: learnHangulHeight(state.writingSessions, state.compositionSettings.endpointStabilization),
      hangulTargetCenter: learnHangulCenter(state.writingSessions, state.compositionSettings.endpointStabilization),
      unitsPerEm: 1000,
    }
    worker.postMessage(request)
  }, [navigate])

  useEffect(() => {
    if (!started.current) {
      started.current = true
      run()
    }
    return () => workerRef.current?.terminate()
  }, [run])

  const cancel = () => workerRef.current?.postMessage({ type: 'cancel' })

  return (
    <section className="grid min-h-[calc(100svh-52px)] place-items-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-[10px] border border-[#E5E7EB] bg-white">
          <LoaderCircle className="size-5 animate-spin text-[#2457F5]" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">폰트를 만들고 있어요</h1>
        <p className="mt-2 min-h-6 text-sm text-[#62656B]">{generation.message || '글자 형태를 정리하는 중…'}</p>
        <Progress className="mt-7 h-2" value={generation.progress} />
        <p className="mt-3 text-xs tabular-nums text-[#92969D]">{Math.round(generation.progress)}%</p>

        {generation.error ? (
          <div className="mt-8 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-left">
            <p className="text-sm font-medium text-[#991B1B]">생성 중 문제가 발생했습니다</p>
            <p className="mt-1 text-xs leading-5 text-[#B42318]">{generation.error}</p>
            <Button className="mt-4" size="sm" variant="secondary" onClick={run}><RotateCcw className="size-3.5" /> 다시 시도</Button>
          </div>
        ) : (
          <Button className="mt-8" variant="ghost" size="sm" onClick={cancel}><X className="size-3.5" /> 생성 취소</Button>
        )}
      </div>
    </section>
  )
}
