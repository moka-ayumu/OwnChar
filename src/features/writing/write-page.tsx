import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, Type } from 'lucide-react'
import { exerciseCompletion, WRITING_EXERCISES } from '@/collection/exercises'
import { completedPromptCount, missingPrompts, PROMPT_COUNT } from '@/collection/prompts'
import { AppNav } from '@/components/app-nav'
import { Hint } from '@/components/hint'
import { ProgressRing } from '@/components/progress-ring'
import { RailBrand } from '@/components/rail-brand'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { flow } from '@/lib/flow'
import { projectActions } from '@/project/store'
import { useProject } from '@/project/use-project'
import { CellPopover } from './cell-popover'
import { FixedCaptureLayer } from './fixed-capture-layer'
import { GenerationDialogs, type GenerationDialog } from './generation-dialogs'
import { ToolRail, type CanvasTool } from './tool-rail'
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
const RAIL_KEY = 'ownchar:write-rail'

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

function readRailCollapsed() {
  try {
    return window.localStorage.getItem(RAIL_KEY) === 'closed'
  } catch {
    return false
  }
}

function writeRailCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(RAIL_KEY, collapsed ? 'closed' : 'open')
  } catch {
    // Like the hint, the rail's state is a per-device convenience; without storage it opens.
  }
}

export function WritePage(search: WriteSearch) {
  const storedIndex = useProject((state) => state.currentExercise)
  const sourceIndex = search.exerciseId ? WRITING_EXERCISES.findIndex((item) => item.id === search.exerciseId) : -1
  const currentIndex = sourceIndex >= 0 ? sourceIndex : Math.min(storedIndex, WRITING_EXERCISES.length - 1)
  return <WriteSentence key={WRITING_EXERCISES[currentIndex].id} currentIndex={currentIndex} {...search} />
}

function WriteSentence({ currentIndex, exerciseId: sourceExerciseId, cellIndex: sourceCellIndex, returnGlyph, returnQuery }: WriteSearch & { currentIndex: number }) {
  const navigate = useNavigate()
  const drawings = useProject((state) => state.drawings)
  const sessions = useProject((state) => state.writingSessions)
  const status = useProject((state) => state.status)
  const sourceDirty = useProject((state) => state.sourceDirty)
  const generatedFont = useProject((state) => state.generatedFont)
  const endpointStabilization = useProject((state) => state.compositionSettings.endpointStabilization)
  const modifiedGlyphCount = useProject((state) => Object.keys(state.glyphOverrides).length)
  const exercise = WRITING_EXERCISES[currentIndex]
  const viewport = useRef<HTMLDivElement>(null)
  const session = useWritingSession(exercise, viewport)
  const { grid, strokes } = session
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [tool, setTool] = useState<CanvasTool>('pen')
  const [showPlaceholderHint, setShowPlaceholderHint] = useState(readPlaceholderHint)
  const [generationDialog, setGenerationDialog] = useState<GenerationDialog>(null)
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed)
  const surface = useRef<WritingSurfaceHandle>(null)
  const stage = useRef<HTMLElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const region = useRef<HTMLDivElement>(null)
  const { active } = session
  // A finished cell closes its popover, so the next cell is free to write in.
  const popoverOpen = active.cellIndex !== null && (active.current !== null || active.reopened)
  const writtenCells = new Set(session.capture.groups.filter((group) => group.strokes.length).map((group) => group.cellIndex))
  const canvasWidth = grid.columns * grid.cellSize
  const canvasHeight = session.rowCount * grid.cellSize
  const showsSourceCell = sourceExerciseId === exercise.id && sourceCellIndex !== undefined && sourceCellIndex >= 0 && sourceCellIndex < exercise.cells.length

  useEffect(() => {
    if (status === 'empty') void navigate({ to: '/' })
  }, [navigate, status])

  // Arriving from a glyph's source link, bring its cell into view.
  useEffect(() => {
    if (!showsSourceCell || sourceCellIndex === undefined || !region.current) return
    const row = Math.floor(sourceCellIndex / grid.columns)
    region.current.scrollTop = Math.max(0, row * grid.cellSize - region.current.clientHeight / 3)
  }, [showsSourceCell, sourceCellIndex, grid])

  const togglePlaceholderHint = () => {
    setShowPlaceholderHint(!showPlaceholderHint)
    writePlaceholderHint(!showPlaceholderHint)
  }

  const toggleRail = () => {
    setRailCollapsed(!railCollapsed)
    writeRailCollapsed(!railCollapsed)
  }

  const clear = () => {
    surface.current?.clear()
    session.clear()
  }

  const go = (index: number) => {
    const next = Math.max(0, Math.min(WRITING_EXERCISES.length - 1, index))
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
    // The generation stage starts at the full rail width, further right than this one.
    const stageLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail')) || (stageBox?.left ?? 0)
    const frameBox = frame.current?.getBoundingClientRect()
    const clipBox = region.current?.getBoundingClientRect()
    flow.leaveWriting(stageBox && frameBox && clipBox && strokes.length ? {
      exerciseId: exercise.id,
      frame: { x: frameBox.left - stageLeft, y: frameBox.top - stageBox.top, width: frameBox.width, height: frameBox.height },
      clip: { x: clipBox.left - stageLeft, y: Math.max(0, clipBox.top - stageBox.top), width: clipBox.width, height: Math.min(clipBox.bottom, stageBox.bottom) - Math.max(clipBox.top, stageBox.top) },
    } : null)
    void navigate({ to: '/generate', viewTransition: true })
  }
  const proceedToGeneration = () => {
    if (sourceDirty && modifiedGlyphCount > 0) setGenerationDialog('conflict')
    else generate()
  }
  const requestGeneration = () => remaining.length > 0 ? setGenerationDialog('missing') : proceedToGeneration()

  return (
    <div className="flow write-flow" data-collapsed={railCollapsed ? 'true' : undefined}>
      {/* Closing the rail only narrows it: every row keeps its place and its leading icon, and the text beside it is cut off. */}
      <aside className="rail write-rail">
        <RailBrand collapsed={railCollapsed} onToggle={toggleRail} />
        <div className="write-sidebar-overview">
          <Hint className="relative block" label={railCollapsed && `전체 수집률 ${completed} / ${PROMPT_COUNT}`}>
            <span className="rail-label rail-text">전체 수집률</span>
            <div className="rail-figure rail-text mt-1">{completed}<small>/ {PROMPT_COUNT}</small></div>
            <Progress className="rail-text mt-3" value={completed / PROMPT_COUNT * 100} />
            {/* Closed, the same progress stands upright in the space the figure leaves. */}
            <span className="rail-total-upright" aria-hidden="true"><i style={{ height: `${completed / PROMPT_COUNT * 100}%` }} /></span>
          </Hint>
          <div className="write-character-section">
            <div className="rail-text mb-2 flex items-center justify-between"><span className="rail-label">연습 문장</span><span className="tnum text-xs font-semibold">{currentIndex + 1} / {WRITING_EXERCISES.length}</span></div>
            <div className="exercise-list" aria-label="문장 진행 상황">
              {WRITING_EXERCISES.map((item, index) => {
                const progress = exerciseCompletion(item, drawings)
                const count = `${progress.completed} / ${progress.total} 자모`
                return (
                  <Hint key={item.id} className="block" label={railCollapsed ? `${item.title} · ${count}` : count}>
                    <button onClick={() => go(index)} aria-label={`${item.title}, ${count}`} aria-current={index === currentIndex ? 'step' : undefined} className={`exercise-chip ${index === currentIndex ? 'current' : ''}`}>
                      <span className="exercise-chip-state"><ProgressRing value={progress.completed} total={progress.total} /></span>
                      <strong>{item.title}</strong>
                    </button>
                  </Hint>
                )
              })}
            </div>
          </div>
        </div>
        <div className="write-actions">
          <Button size="icon" variant="secondary" aria-label="이전 문장" title="이전 문장" disabled={currentIndex === 0} onClick={() => go(currentIndex - 1)}><ArrowLeft className="size-4" /></Button>
          {isLast
            ? <Button aria-label="폰트 만들기" title={railCollapsed ? '폰트 만들기' : undefined} onClick={requestGeneration}>{railCollapsed ? <Type className="size-4" /> : '폰트 만들기'}</Button>
            : <Button aria-label="다음 문장" title={railCollapsed ? '다음 문장' : undefined} onClick={() => go(currentIndex + 1)}>{!railCollapsed && '다음 문장'}<ArrowRight className="size-4" /></Button>}
        </div>
        {!railCollapsed && !isLast && <Button className="mt-2 w-full" variant="ghost" onClick={requestGeneration}>지금 폰트 만들기</Button>}
        {!railCollapsed && generatedFont && <Button className="mt-2 w-full px-2" variant="secondary" onClick={() => void (returnGlyph === undefined ? navigate({ to: '/preview', viewTransition: true }) : navigate({ to: '/edit', search: { glyph: returnGlyph, query: returnQuery } }))}>기존 폰트 미리보기 · 편집</Button>}
      </aside>

      <section className="stage write-stage" ref={stage}>
        <ToolRail
          tool={tool} strokeWidth={strokeWidth} endpointStabilization={endpointStabilization} showHints={showPlaceholderHint}
          onTool={setTool} onStrokeWidth={setStrokeWidth} onToggleHints={togglePlaceholderHint}
          onEndpointStabilization={(value) => projectActions.updateCompositionSettings({ endpointStabilization: value })}
          cellSize={grid.cellSize} cellSizeLocked={strokes.length > 0} onCellSize={session.setCellSize}
          onUndo={() => surface.current?.undo()} onRedo={() => surface.current?.redo()} onClear={clear}
        />
        <div className="write-main">
          <div className="sentence-prompt">
            <h1>{exercise.text}</h1>
            <div>
              <Hint side="bottom" label={`${exerciseProgress.completed} / ${exerciseProgress.total} 자모`}>
                <button type="button" className="sentence-ring" aria-label={`이 문장에서 자모 ${exerciseProgress.completed} / ${exerciseProgress.total} 수집`}><ProgressRing value={exerciseProgress.completed} total={exerciseProgress.total} size={22} /></button>
              </Hint>
              <AppNav />
            </div>
          </div>
          <div className="sentence-canvas-region" ref={region}>
            <div className="sentence-canvas-scroll" ref={viewport}>
              <div className="sentence-canvas-frame" ref={frame} data-testid="writing-canvas" data-cell-size={grid.cellSize} data-columns={grid.columns} data-rows={session.rowCount} data-assignment-prompts={session.capture.assignments.map((item) => item.promptId).join(',')} style={{ width: canvasWidth, height: canvasHeight }}>
                <FixedCaptureLayer exercise={exercise} drawings={drawings} sessions={sessions} cellGuides={session.cellGuides} groups={session.capture.groups} showHints={showPlaceholderHint} grid={grid} width={canvasWidth} height={canvasHeight} />
                <div className="writing-grid">
                  {exercise.cells.map((cell, index) => {
                    const isSource = showsSourceCell && sourceCellIndex === index
                    const isActive = active.cellIndex === index
                    const state = [isSource && 'source-cell-highlight', session.finished[index] && 'is-complete', isActive && popoverOpen && 'is-active'].filter(Boolean).join(' ')
                    return (
                      <div key={index} data-source-cell={isSource ? 'true' : undefined} data-complete={session.finished[index] ? 'true' : undefined} className={state || undefined} style={{ width: grid.cellSize }}>
                        {writtenCells.has(index) && !(isActive && popoverOpen)
                          ? <button type="button" aria-label={`${cell.char} 칸의 자모 나누기 고치기`} title="자모 나누기 고치기" onClick={() => session.reopenCell(index)}>{cell.char}</button>
                          : <span aria-hidden="true">{cell.char}</span>}
                      </div>
                    )
                  })}
                </div>
                <WritingSurface key={`${exercise.id}:${grid.columns}`} ref={surface} initialStrokes={strokes} cellSize={grid.cellSize} width={canvasWidth} height={canvasHeight} strokeWidth={strokeWidth} endpointStabilization={endpointStabilization} tool={tool} onChange={(next) => session.save(next)} />
                {active.cellIndex !== null && popoverOpen && (
                  <CellPopover
                    key={active.cellIndex} cell={exercise.cells[active.cellIndex]} cellIndex={active.cellIndex} grid={grid}
                    slots={active.slots} current={active.current} remaining={active.remaining} canFinish={active.canFinish} reopened={active.reopened}
                    warning={session.boundaryWarning} onCollect={session.collectActiveSlot} onFinish={session.finishActiveSlot} onClose={session.closeCell}
                  />
                )}
              </div>
            </div>
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
