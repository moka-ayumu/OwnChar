import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { exerciseCompletion, WRITING_EXERCISES } from '@/collection/exercises'
import { completedPromptCount, missingPrompts, PROMPT_COUNT } from '@/collection/prompts'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { flow } from '@/lib/flow'
import { projectActions } from '@/project/store'
import { useProject } from '@/project/use-project'
import { BoundaryControls } from './boundary-controls'
import { CanvasToolbar, type CanvasTool } from './canvas-toolbar'
import { CaptureStrip } from './capture-strip'
import { FixedCaptureLayer } from './fixed-capture-layer'
import { GenerationDialogs, type GenerationDialog } from './generation-dialogs'
import { useWritingSession } from './use-writing-session'
import { WritingSurface, type WritingSurfaceHandle } from './writing-surface'

export interface WriteSearch {
  /** The sentence and cell to show, when arriving from a glyph's source link. */
  exerciseId?: string
  cellIndex?: number
  /** The glyph (and search text) to return to in the editor. */
  returnGlyph?: number
  returnQuery?: string
}

const PLACEHOLDER_HINT_KEY = 'ownchar:placeholder-hint'

function readPlaceholderHint() {
  try {
    return window.localStorage.getItem(PLACEHOLDER_HINT_KEY) !== 'off'
  } catch {
    return true
  }
}

function writePlaceholderHint(enabled: boolean) {
  try {
    window.localStorage.setItem(PLACEHOLDER_HINT_KEY, enabled ? 'on' : 'off')
  } catch {
    // The hint is a per-device convenience; without storage it resets to on.
  }
}

export function WritePage({ exerciseId: sourceExerciseId, cellIndex: sourceCellIndex, returnGlyph, returnQuery }: WriteSearch) {
  const navigate = useNavigate()
  const storedIndex = useProject((state) => state.currentExercise)
  const drawings = useProject((state) => state.drawings)
  const sessions = useProject((state) => state.writingSessions)
  const status = useProject((state) => state.status)
  const sourceDirty = useProject((state) => state.sourceDirty)
  const generatedFont = useProject((state) => state.generatedFont)
  const endpointStabilization = useProject((state) => state.compositionSettings.endpointStabilization)
  const modifiedGlyphCount = useProject((state) => Object.keys(state.glyphOverrides).length)
  const sourceIndex = sourceExerciseId ? WRITING_EXERCISES.findIndex((item) => item.id === sourceExerciseId) : -1
  const currentIndex = sourceIndex >= 0 ? sourceIndex : Math.min(storedIndex, WRITING_EXERCISES.length - 1)
  const exercise = WRITING_EXERCISES[currentIndex]
  const viewport = useRef<HTMLDivElement>(null)
  const session = useWritingSession(exercise, viewport)
  const { grid, strokes } = session
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [tool, setTool] = useState<CanvasTool>('pen')
  const [showPlaceholderHint, setShowPlaceholderHint] = useState(readPlaceholderHint)
  const [generationDialog, setGenerationDialog] = useState<GenerationDialog>(null)
  const surface = useRef<WritingSurfaceHandle>(null)
  const stage = useRef<HTMLElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const canvasWidth = grid.columns * grid.cellSize
  const canvasHeight = session.rowCount * grid.cellSize
  const showsSourceCell = sourceExerciseId === exercise.id && sourceCellIndex !== undefined && sourceCellIndex >= 0 && sourceCellIndex < exercise.cells.length

  useEffect(() => {
    if (status === 'empty') void navigate({ to: '/' })
  }, [navigate, status])

  // Arriving from a glyph's source link, bring its cell into view.
  useEffect(() => {
    if (!showsSourceCell || sourceCellIndex === undefined || !viewport.current) return
    const row = Math.floor(sourceCellIndex / grid.columns)
    viewport.current.scrollTop = Math.max(0, row * grid.cellSize - viewport.current.clientHeight / 3)
  }, [showsSourceCell, sourceCellIndex, viewport, grid])

  const togglePlaceholderHint = () => {
    setShowPlaceholderHint(!showPlaceholderHint)
    writePlaceholderHint(!showPlaceholderHint)
  }

  const clear = () => {
    surface.current?.clear()
    session.clear()
  }

  const go = (index: number) => {
    const next = Math.max(0, Math.min(WRITING_EXERCISES.length - 1, index))
    session.open(WRITING_EXERCISES[next])
    projectActions.showExercise(next)
    if (sourceExerciseId) void navigate({ to: '/write', search: { returnGlyph, returnQuery } })
  }

  const completed = completedPromptCount(drawings)
  const remaining = missingPrompts(drawings)
  const exerciseProgress = exerciseCompletion(exercise, drawings)
  const isLast = currentIndex === WRITING_EXERCISES.length - 1

  const generate = () => {
    // Generation opens on the sentence exactly where it sits now.
    const stageBox = stage.current?.getBoundingClientRect()
    const frameBox = frame.current?.getBoundingClientRect()
    const clipBox = viewport.current?.getBoundingClientRect()
    flow.leaveWriting(stageBox && frameBox && clipBox && strokes.length ? {
      exerciseId: exercise.id,
      frame: { x: frameBox.left - stageBox.left, y: frameBox.top - stageBox.top, width: frameBox.width, height: frameBox.height },
      clip: { x: clipBox.left - stageBox.left, y: Math.max(0, clipBox.top - stageBox.top), width: clipBox.width, height: Math.min(clipBox.bottom, stageBox.bottom) - Math.max(clipBox.top, stageBox.top) },
    } : null)
    void navigate({ to: '/generate', viewTransition: true })
  }
  const proceedToGeneration = () => {
    if (sourceDirty && modifiedGlyphCount > 0) setGenerationDialog('conflict')
    else generate()
  }
  const requestGeneration = () => remaining.length > 0 ? setGenerationDialog('missing') : proceedToGeneration()

  return (
    <div className="flow">
      <aside className="rail">
        <div className="write-sidebar-overview">
          <div>
            <div className="flex items-end justify-between"><span className="rail-label">전체 수집률</span><span className="rail-figure">{completed}<small>/ {PROMPT_COUNT}</small></span></div>
            <Progress className="mt-3" value={completed / PROMPT_COUNT * 100} />
          </div>
          <div>
            <div className="mb-2 flex justify-between"><span className="rail-label">글자 칸 크기</span><span className="tnum text-xs font-semibold">{grid.cellSize}px</span></div>
            <Slider aria-label="글자 칸 크기" min={112} max={184} step={4} disabled={strokes.length > 0} value={[grid.cellSize]} onValueChange={([value]) => session.setCellSize(value)} />
            {strokes.length > 0 && <p className="rail-note mt-2">작성한 획의 칸 위치를 보존하기 위해 크기가 고정됐어요.</p>}
          </div>
          <div className="write-character-section">
            <div className="mb-2 flex items-center justify-between"><span className="rail-label">연습 문장</span><span className="tnum text-xs font-semibold">{currentIndex + 1} / {WRITING_EXERCISES.length}</span></div>
            <div className="exercise-list" aria-label="문장 진행 상황">
              {WRITING_EXERCISES.map((item, index) => {
                const progress = exerciseCompletion(item, drawings)
                const complete = progress.total > 0 && progress.completed === progress.total
                return <button key={item.id} onClick={() => go(index)} aria-current={index === currentIndex ? 'step' : undefined} className={`exercise-chip ${index === currentIndex ? 'current' : ''} ${complete ? 'complete' : ''}`}>
                  <span className="exercise-chip-state">{complete ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}</span>
                  <strong>{item.title}</strong>
                  <small>{progress.completed} / {progress.total} 자모</small>
                </button>
              })}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-5">
          <Button variant="secondary" disabled={currentIndex === 0} onClick={() => go(currentIndex - 1)}>이전 문장</Button>
          {isLast ? <Button onClick={requestGeneration}>폰트 만들기</Button> : <Button onClick={() => go(currentIndex + 1)}>다음 문장</Button>}
        </div>
        {!isLast && <Button className="mt-2 w-full" variant="ghost" onClick={requestGeneration}>지금 폰트 만들기</Button>}
        {generatedFont && <Button className="mt-2 w-full" variant="secondary" onClick={() => void (returnGlyph === undefined ? navigate({ to: '/preview', viewTransition: true }) : navigate({ to: '/edit', search: { glyph: returnGlyph, query: returnQuery } }))}>기존 폰트 미리보기 · 편집</Button>}
      </aside>

      <section className="stage" ref={stage}>
        <div className="sentence-canvas-region">
          <div className="sentence-workspace">
            <div className="sentence-prompt">
              <h1>{exercise.text}</h1>
              <div><span>{exercise.instruction}</span><strong>{exerciseProgress.completed} / {exerciseProgress.total} 자모 수집</strong></div>
            </div>
            <CanvasToolbar
              tool={tool} strokeWidth={strokeWidth} endpointStabilization={endpointStabilization} showHints={showPlaceholderHint}
              onTool={setTool} onStrokeWidth={setStrokeWidth} onToggleHints={togglePlaceholderHint}
              onEndpointStabilization={(value) => projectActions.updateCompositionSettings({ endpointStabilization: value })}
              onUndo={() => surface.current?.undo()} onRedo={() => surface.current?.redo()} onClear={clear}
            />
            <div className="sentence-canvas-scroll" ref={viewport}>
              <div className="sentence-canvas-frame" ref={frame} data-testid="writing-canvas" data-cell-size={grid.cellSize} data-columns={grid.columns} data-rows={session.rowCount} data-assignment-prompts={session.capture.assignments.map((item) => item.promptId).join(',')} style={{ width: canvasWidth, height: canvasHeight }}>
                <FixedCaptureLayer exercise={exercise} drawings={drawings} sessions={sessions} cellGuides={session.cellGuides} groups={session.capture.groups} showHints={showPlaceholderHint} grid={grid} width={canvasWidth} height={canvasHeight} />
                <div className="writing-grid" aria-hidden="true">
                  {exercise.cells.map((cell, index) => {
                    const isSource = showsSourceCell && sourceCellIndex === index
                    return <div key={index} data-source-cell={isSource ? 'true' : undefined} className={isSource ? 'source-cell-highlight' : undefined} style={{ width: grid.cellSize }}><span>{cell.char}</span></div>
                  })}
                </div>
                <WritingSurface key={exercise.id} ref={surface} initialStrokes={sessions[exercise.id]?.elements ?? []} cellSize={grid.cellSize} width={canvasWidth} height={canvasHeight} strokeWidth={strokeWidth} endpointStabilization={endpointStabilization} tool={tool} onChange={(next) => session.save(next)} />
              </div>
            </div>
            <BoundaryControls
              cell={session.active.cell} target={session.active.target} warning={session.boundaryWarning}
              canUndo={session.active.hasBoundaries} canComplete={session.active.canComplete}
              onUndo={session.undoActiveBoundary} onComplete={session.completeActiveTarget}
            />
            <CaptureStrip exercise={exercise} groups={session.capture.groups} grid={grid} endpointStabilization={endpointStabilization} />
          </div>
        </div>
      </section>

      <GenerationDialogs
        dialog={generationDialog} missing={remaining} modifiedGlyphCount={modifiedGlyphCount}
        onClose={() => setGenerationDialog(null)} onProceed={proceedToGeneration} onKeepEdits={generate}
        onDiscardEdits={() => { projectActions.clearGlyphTransformsForRecompose(); generate() }}
      />
    </div>
  )
}
