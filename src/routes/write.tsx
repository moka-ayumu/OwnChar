import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, Eraser, PenLine, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { WritingSurface, type WritingSurfaceHandle } from '@/components/writing-surface'
import { strokeSvgPath, type RawStroke } from '@/font/stroke-outline'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { useProject } from '@/hooks/use-project'
import { completedPromptCount, missingPrompts, PROMPT_COUNT } from '@/lib/prompts'
import { exerciseCompletion, WRITING_EXERCISES } from '@/lib/writing-exercises'
import { projectActions } from '@/store/project-store'
import type { CompositionSettings, DrawingRecord, JamoBoundary, StrokeAssignment, StrokePath, WritingSessionRecord } from '@/types/project'
import { cellId, indexedSlotsForCell, isFixedSlot } from '@/font/composition-inputs'
import { hangulComposeOptions } from '@/font/composer'
import { composeGuideParts } from '@/font/syllable-lock'
import { useCompositionContext } from '@/hooks/use-composition-context'

export const Route = createFileRoute('/write')({
  validateSearch: (search: Record<string, unknown>): { exerciseId?: string; cellIndex?: number; returnGlyph?: number; returnQuery?: string } => ({
    exerciseId: typeof search.exerciseId === 'string' ? search.exerciseId : undefined,
    cellIndex: typeof search.cellIndex === 'number' && Number.isInteger(search.cellIndex) ? search.cellIndex : undefined,
    returnGlyph: typeof search.returnGlyph === 'number' && Number.isInteger(search.returnGlyph) ? search.returnGlyph : undefined,
    returnQuery: typeof search.returnQuery === 'string' ? search.returnQuery : undefined,
  }),
  component: WritePage,
})

type SceneElement = Record<string, any>

function drawableElements(elements: readonly SceneElement[]) {
  return elements.filter((element) => element.type === 'freedraw' && !element.isDeleted)
}

function pathsFromElements(elements: readonly SceneElement[], cellSize: number, offsetX = 0, endpointStabilization = 1): StrokePath[] {
  return drawableElements(elements).map((element) => ({
    d: strokeSvgPath(element as RawStroke, cellSize, endpointStabilization),
    x: element.x - offsetX,
    y: element.y,
    width: element.width,
    height: element.height,
  }))
}

function previewFromPaths(paths: StrokePath[]) {
  if (!paths.length) return ''
  const minX = Math.min(...paths.map((path) => path.x))
  const minY = Math.min(...paths.map((path) => path.y))
  const maxX = Math.max(...paths.map((path) => path.x + Math.max(path.width, 1)))
  const maxY = Math.max(...paths.map((path) => path.y + Math.max(path.height, 1)))
  const body = paths.map((path) => `<path d="${path.d}" transform="translate(${path.x} ${path.y})" fill="#17181A" fill-rule="nonzero"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}">${body}</svg>`
}

function cellIndexForElement(element: SceneElement, cellSize: number, columns: number, cellCount: number) {
  const firstPointX = Array.isArray(element.points?.[0]) ? Number(element.points[0][0] ?? 0) : 0
  const firstPointY = Array.isArray(element.points?.[0]) ? Number(element.points[0][1] ?? 0) : 0
  const startX = Number(element.x ?? 0) + firstPointX
  const startY = Number(element.y ?? 0) + firstPointY
  const column = Math.max(0, Math.min(columns - 1, Math.floor(startX / cellSize)))
  const row = Math.max(0, Math.floor(startY / cellSize))
  return Math.max(0, Math.min(cellCount - 1, row * columns + column))
}

function editableSlotsForCell(cell: typeof WRITING_EXERCISES[number]['cells'][number], cellIndex: number, exercise: typeof WRITING_EXERCISES[number], drawings: Record<string, DrawingRecord>) {
  return indexedSlotsForCell(cell)
    .filter(({ slot, slotIndex }) => !isFixedSlot(slot.promptId, cellIndex, slotIndex, exercise, drawings))
}

function validBoundariesForCell(strokes: SceneElement[], editableSlots: ReturnType<typeof editableSlotsForCell>, boundaries: JamoBoundary[]) {
  const result: JamoBoundary[] = []
  let previousIndex = -1
  for (const boundary of boundaries) {
    const target = editableSlots[result.length]
    const elementIndex = strokes.findIndex((stroke) => String(stroke.id) === boundary.afterElementId)
    if (!target || boundary.slotIndex !== target.slotIndex || boundary.promptId !== target.slot.promptId || elementIndex <= previousIndex) break
    result.push(boundary)
    previousIndex = elementIndex
  }
  return result
}

function normalizeBoundaries(elements: readonly SceneElement[], cellSize: number, columns: number, exercise: typeof WRITING_EXERCISES[number], drawings: Record<string, DrawingRecord>, boundaries: Record<number, JamoBoundary[]>) {
  const byCell = Array.from({ length: exercise.cells.length }, () => [] as SceneElement[])
  for (const element of drawableElements(elements)) byCell[cellIndexForElement(element, cellSize, columns, exercise.cells.length)].push(element)
  const normalized: Record<number, JamoBoundary[]> = {}
  exercise.cells.forEach((cell, cellIndex) => {
    const valid = validBoundariesForCell(byCell[cellIndex], editableSlotsForCell(cell, cellIndex, exercise, drawings), boundaries[cellIndex] ?? [])
    if (valid.length) normalized[cellIndex] = valid
  })
  return normalized
}

function assignElements(elements: readonly SceneElement[], cellSize: number, columns: number, exercise: typeof WRITING_EXERCISES[number], drawings: Record<string, DrawingRecord>, boundaries: Record<number, JamoBoundary[]>) {
  const byCell = Array.from({ length: exercise.cells.length }, () => [] as SceneElement[])
  for (const element of drawableElements(elements)) {
    const cellIndex = cellIndexForElement(element, cellSize, columns, exercise.cells.length)
    byCell[cellIndex].push(element)
  }

  const groups: Array<{ cellIndex: number; slotIndex: number; promptId: string; slot: ReturnType<typeof indexedSlotsForCell>[number]['slot']; elements: SceneElement[] }> = []
  const assignments: StrokeAssignment[] = []
  exercise.cells.forEach((cell, cellIndex) => {
    const strokes = byCell[cellIndex]
    let cursor = 0
    const editableSlots = editableSlotsForCell(cell, cellIndex, exercise, drawings)
    const confirmed = validBoundariesForCell(strokes, editableSlots, boundaries[cellIndex] ?? [])
    editableSlots.forEach(({ slot, slotIndex }, editableIndex) => {
      const isLast = editableIndex === editableSlots.length - 1
      const boundary = confirmed[editableIndex]
      const boundaryEnd = boundary ? strokes.findIndex((stroke) => String(stroke.id) === boundary.afterElementId) + 1 : -1
      const end = boundaryEnd > cursor ? boundaryEnd : isLast ? strokes.length : Math.min(strokes.length, cursor + slot.expectedStrokes)
      const assigned = strokes.slice(cursor, end)
      cursor = end
      groups.push({ cellIndex, slotIndex, promptId: slot.promptId, slot, elements: assigned })
      for (const element of assigned) assignments.push({
        elementId: String(element.id), cellIndex, slotIndex, promptId: slot.promptId,
      })
    })
  })
  return { groups, assignments }
}

interface GuidePath { key: string; cellIndex: number; promptId: string; d: string; transform: string }

/**
 * Fixed jamo are drawn from the same composition the font uses, so a guide in
 * a writing cell is exactly the glyph the font will contain (in cell space,
 * before the uniform font calibration).
 */
function FixedCaptureLayer(props: {
  exercise: typeof WRITING_EXERCISES[number]
  drawings: Record<string, DrawingRecord>
  sessions: Record<string, WritingSessionRecord>
  settings: CompositionSettings
  cellSize: number
  columns: number
  width: number
  height: number
}) {
  const { exercise, drawings } = props
  const hasFixed = exercise.cells.some((cell, cellIndex) => indexedSlotsForCell(cell)
    .some(({ slot, slotIndex }) => isFixedSlot(slot.promptId, cellIndex, slotIndex, exercise, drawings)))
  return hasFixed ? <ComposedGuideLayer {...props} /> : null
}

function ComposedGuideLayer({ exercise, drawings, sessions, settings, cellSize, columns, width, height }: Parameters<typeof FixedCaptureLayer>[0]) {
  const { shapes, composition, visualScale } = useCompositionContext(drawings, sessions, settings)
  const paths = useMemo(() => exercise.cells.flatMap((cell, cellIndex): GuidePath[] => {
    const fixed = indexedSlotsForCell(cell).filter(({ slot, slotIndex }) => isFixedSlot(slot.promptId, cellIndex, slotIndex, exercise, drawings))
    if (!fixed.length) return []
    const cellX = (cellIndex % columns) * cellSize
    const cellY = Math.floor(cellIndex / columns) * cellSize
    const codePoint = cell.char.codePointAt(0)!
    if (codePoint >= 0xac00 && codePoint <= 0xd7a3 && fixed.every(({ slot }) => slot.role)) {
      const { parts } = composeGuideParts(codePoint, shapes, settings, hangulComposeOptions(composition, visualScale), cellId(exercise.id, cellIndex))
      const scale = cellSize / 1000
      return fixed.map(({ slot, slotIndex }) => ({
        key: `${cellIndex}-${slotIndex}`,
        cellIndex,
        promptId: slot.promptId,
        // An integer argument keeps font coordinates (no y flip); the transform flips.
        d: parts[slot.role!].toPathData(2),
        transform: `matrix(${scale} 0 0 ${-scale} ${cellX} ${cellY + cellSize})`,
      }))
    }
    // Non-syllable guides keep the captured outline where it was written.
    return fixed.flatMap(({ slot, slotIndex }) => {
      const record = drawings[slot.promptId]
      const sourceSize = record.capture ? sessions[record.capture.exerciseId]?.cellSize ?? cellSize : cellSize
      const scale = cellSize / sourceSize
      return record.paths.map((path, pathIndex) => ({
        key: `${cellIndex}-${slotIndex}-${pathIndex}`,
        cellIndex,
        promptId: slot.promptId,
        d: path.d,
        transform: `matrix(${scale} 0 0 ${scale} ${cellX + path.x * scale} ${cellY + path.y * scale})`,
      }))
    })
  }), [exercise, drawings, sessions, settings, cellSize, columns, shapes, composition, visualScale])
  if (!paths.length) return null
  return <svg className="fixed-capture-layer" viewBox={`0 0 ${width} ${height}`} aria-label="이미 수집되어 고정된 자모">
    {paths.map((path) => <path key={path.key} data-cell-index={path.cellIndex} data-prompt-id={path.promptId} d={path.d} transform={path.transform} fillRule="nonzero" />)}
  </svg>
}

function WritePage() {
  const navigate = useNavigate()
  const { exerciseId: sourceExerciseId, cellIndex: sourceCellIndex, returnGlyph, returnQuery } = Route.useSearch()
  const storedIndex = useProject((state) => state.currentPrompt)
  const drawings = useProject((state) => state.drawings)
  const sessions = useProject((state) => state.writingSessions)
  const status = useProject((state) => state.status)
  const sourceDirty = useProject((state) => state.sourceDirty)
  const generatedFont = useProject((state) => state.generatedFont)
  const compositionSettings = useProject((state) => state.compositionSettings)
  const endpointStabilization = compositionSettings.endpointStabilization
  const modifiedGlyphCount = useProject((state) => Object.keys(state.glyphOverrides).length)
  const sourceIndex = sourceExerciseId ? WRITING_EXERCISES.findIndex((item) => item.id === sourceExerciseId) : -1
  const currentIndex = sourceIndex >= 0 ? sourceIndex : Math.min(storedIndex, WRITING_EXERCISES.length - 1)
  const exercise = WRITING_EXERCISES[currentIndex]
  const savedSession = sessions?.[exercise.id]
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [cellSize, setCellSize] = useState(savedSession?.cellSize ?? 148)
  const [columns, setColumns] = useState(savedSession?.columns ?? Math.min(6, exercise.cells.length))
  const [tool, setTool] = useState<'freedraw' | 'eraser'>('freedraw')
  const [sceneElements, setSceneElements] = useState<readonly SceneElement[]>(savedSession?.elements as readonly SceneElement[] ?? [])
  const [boundaries, setBoundaries] = useState<Record<number, JamoBoundary[]>>(savedSession?.boundaries ?? {})
  const [boundaryWarning, setBoundaryWarning] = useState('')
  const [generationDialog, setGenerationDialog] = useState<'missing' | 'conflict' | null>(null)
  const api = useRef<WritingSurfaceHandle>(null)
  const boundariesRef = useRef<Record<number, JamoBoundary[]>>(savedSession?.boundaries ?? {})
  const canvasViewport = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const lastElementRevision = useRef('')
  const activeColumns = Math.max(1, Math.min(columns, exercise.cells.length))
  const rowCount = Math.ceil(exercise.cells.length / activeColumns)
  const canvasWidth = activeColumns * cellSize
  const canvasHeight = rowCount * cellSize

  useEffect(() => {
    if (status === 'empty') void navigate({ to: '/' })
  }, [navigate, status])

  useEffect(() => {
    const viewport = canvasViewport.current
    if (!viewport || sceneElements.length > 0) return
    const observer = new ResizeObserver(([entry]) => {
      const available = Math.max(cellSize, entry.contentRect.width - 2)
      const next = Math.max(1, Math.min(exercise.cells.length, Math.floor(available / cellSize)))
      setColumns((current) => current === next ? current : next)
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [cellSize, exercise.cells.length, exercise.id, sceneElements.length])

  const capture = useMemo(
    () => assignElements(sceneElements, cellSize, activeColumns, exercise, drawings, boundaries),
    [activeColumns, boundaries, cellSize, drawings, exercise, sceneElements],
  )

  const saveElements = (elements: readonly SceneElement[], requestedBoundaries = boundariesRef.current) => {
    const normalizedBoundaries = normalizeBoundaries(elements, cellSize, activeColumns, exercise, drawings, requestedBoundaries)
    if (JSON.stringify(normalizedBoundaries) !== JSON.stringify(boundaries)) {
      const requestedCount = Object.values(requestedBoundaries).reduce((sum, items) => sum + items.length, 0)
      const normalizedCount = Object.values(normalizedBoundaries).reduce((sum, items) => sum + items.length, 0)
      if (normalizedCount < requestedCount) setBoundaryWarning('경계로 지정한 획이 지워져 이후 자모 경계를 다시 확인해 주세요.')
      boundariesRef.current = normalizedBoundaries
      setBoundaries(normalizedBoundaries)
    }
    const revision = `${elements.map((element) => `${element.id}:${element.version}:${element.isDeleted ? 1 : 0}`).join('|')}::${JSON.stringify(normalizedBoundaries)}`
    if (revision === lastElementRevision.current) return
    lastElementRevision.current = revision
    setSceneElements(elements)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const { groups, assignments } = assignElements(elements, cellSize, activeColumns, exercise, drawings, normalizedBoundaries)
      const records: DrawingRecord[] = groups.flatMap((group) => {
        if (!group.elements.length) return []
        const slot = group.slot
        const cellX = (group.cellIndex % activeColumns) * cellSize
        const cellY = Math.floor(group.cellIndex / activeColumns) * cellSize
        const paths = pathsFromElements(group.elements, cellSize, cellX, endpointStabilization).map((path) => ({ ...path, y: path.y - cellY }))
        return [{
          promptId: slot.promptId,
          codePoint: slot.char.codePointAt(0)!,
          elements: structuredClone(group.elements) as readonly Record<string, unknown>[],
          paths,
          previewSvg: previewFromPaths(paths),
          updatedAt: Date.now(),
          capture: { exerciseId: exercise.id, cellIndex: group.cellIndex, slotIndex: group.slotIndex },
        }]
      })
      const session: WritingSessionRecord = {
        exerciseId: exercise.id, text: exercise.text,
        elements: structuredClone(elements) as readonly Record<string, unknown>[],
        assignments, boundaries: normalizedBoundaries, cellSize, columns: activeColumns, updatedAt: Date.now(),
      }
      projectActions.saveSentenceCapture(session, records)
    }, 250)
  }

  const setActiveTool = (next: 'freedraw' | 'eraser') => {
    setTool(next)
  }

  const clear = () => {
    boundariesRef.current = {}
    setBoundaries({})
    setBoundaryWarning('')
    api.current?.clear()
    saveElements([], {})
  }

  const go = (index: number) => {
    const next = Math.max(0, Math.min(WRITING_EXERCISES.length - 1, index))
    const nextSession = sessions?.[WRITING_EXERCISES[next].id]
    lastElementRevision.current = ''
    setSceneElements(nextSession?.elements as readonly SceneElement[] ?? [])
    boundariesRef.current = nextSession?.boundaries ?? {}
    setBoundaries(boundariesRef.current)
    setBoundaryWarning('')
    setCellSize(nextSession?.cellSize ?? 148)
    setColumns(nextSession?.columns ?? Math.min(6, WRITING_EXERCISES[next].cells.length))
    projectActions.navigatePrompt(next, WRITING_EXERCISES.length)
    if (sourceExerciseId) void navigate({ to: '/write', search: { returnGlyph, returnQuery } })
  }
  useEffect(() => {
    if (sourceExerciseId !== exercise.id || sourceCellIndex === undefined || sourceCellIndex < 0 || sourceCellIndex >= exercise.cells.length) return
    const viewport = canvasViewport.current
    if (!viewport) return
    const row = Math.floor(sourceCellIndex / activeColumns)
    viewport.scrollTop = Math.max(0, row * cellSize - viewport.clientHeight / 3)
  }, [sourceExerciseId, sourceCellIndex, exercise.id, exercise.cells.length, activeColumns, cellSize])
  const completed = completedPromptCount(drawings)
  const remaining = missingPrompts(drawings)
  const missingBase = remaining.filter((item) => !item.variantRole && item.group !== 'symbol')
  const missingSymbols = remaining.filter((item) => item.group === 'symbol')
  const missingVariants = remaining.filter((item) => item.variantRole)
  const exerciseProgress = exerciseCompletion(exercise, drawings)
  const activeStroke = drawableElements(sceneElements).at(-1)
  const activeCellIndex = activeStroke ? cellIndexForElement(activeStroke, cellSize, activeColumns, exercise.cells.length) : null
  const activeCell = activeCellIndex === null ? null : exercise.cells[activeCellIndex]
  const activeCellStrokes = activeCellIndex === null ? [] : drawableElements(sceneElements).filter((element) => cellIndexForElement(element, cellSize, activeColumns, exercise.cells.length) === activeCellIndex)
  const activeEditableSlots = activeCell && activeCellIndex !== null ? editableSlotsForCell(activeCell, activeCellIndex, exercise, drawings) : []
  const activeBoundaries = activeCell && activeCellIndex !== null ? validBoundariesForCell(activeCellStrokes, activeEditableSlots, boundaries[activeCellIndex] ?? []) : []
  const activeTarget = activeEditableSlots[activeBoundaries.length]
  const previousBoundaryIndex = activeBoundaries.length
    ? activeCellStrokes.findIndex((stroke) => String(stroke.id) === activeBoundaries.at(-1)!.afterElementId)
    : -1
  const canCompleteTarget = Boolean(activeTarget && activeCellStrokes.length > previousBoundaryIndex + 1)
  const activeRoleSlots = activeTarget && activeCell ? indexedSlotsForCell(activeCell).map(({ slot }) => slot).filter((slot) => slot.role === activeTarget.slot.role) : []
  const activeRolePosition = activeTarget && activeCell ? activeRoleSlots.findIndex((slot) => slot === activeTarget.slot) : -1
  const roleLabel = activeTarget?.slot.role === 'initial' ? '초성' : activeTarget?.slot.role === 'medial' ? '중성' : activeTarget?.slot.role === 'final' ? '종성' : '글자'
  const componentLabel = activeRoleSlots.length > 1 ? ` ${activeRolePosition + 1}/${activeRoleSlots.length}` : ''

  const completeActiveTarget = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!canCompleteTarget || activeCellIndex === null || !activeTarget) return
    const lastStroke = activeCellStrokes.at(-1)!
    const nextBoundaries = {
      ...boundaries,
      [activeCellIndex]: [...activeBoundaries, {
        slotIndex: activeTarget.slotIndex,
        promptId: activeTarget.slot.promptId,
        afterElementId: String(lastStroke.id),
        confirmedAt: event.timeStamp,
      }],
    }
    setBoundaryWarning('')
    boundariesRef.current = nextBoundaries
    setBoundaries(nextBoundaries)
    saveElements(sceneElements, nextBoundaries)
  }

  const undoActiveBoundary = () => {
    if (activeCellIndex === null || !activeBoundaries.length) return
    const nextBoundaries = { ...boundaries }
    const remaining = activeBoundaries.slice(0, -1)
    if (remaining.length) nextBoundaries[activeCellIndex] = remaining
    else delete nextBoundaries[activeCellIndex]
    setBoundaryWarning('')
    boundariesRef.current = nextBoundaries
    setBoundaries(nextBoundaries)
    saveElements(sceneElements, nextBoundaries)
  }

  const proceedToGeneration = () => {
    if (sourceDirty && modifiedGlyphCount > 0) {
      setGenerationDialog('conflict')
      return
    }
    void navigate({ to: '/generate' })
  }

  const requestGeneration = () => remaining.length > 0 ? setGenerationDialog('missing') : proceedToGeneration()

  return (
    <div className="write-layout">
      <aside className="write-panel">
        <div className="write-sidebar-overview">
          <div>
            <div className="flex items-center justify-between text-sm"><span className="font-medium">전체 수집률</span><span className="tabular-nums text-[#62656B]">{completed} / {PROMPT_COUNT}</span></div>
            <Progress className="mt-3" value={completed / PROMPT_COUNT * 100} />
          </div>
          <div>
            <div className="mb-2 flex justify-between text-xs text-[#62656B]"><span>글자 칸 크기</span><span>{cellSize}px</span></div>
            <Slider aria-label="글자 칸 크기" min={112} max={184} step={4} disabled={sceneElements.length > 0} value={[cellSize]} onValueChange={([value]) => setCellSize(value)} />
            {sceneElements.length > 0 && <p className="mt-2 text-[10px] leading-4 text-[#92969D]">작성한 획의 칸 위치를 보존하기 위해 크기가 고정됐어요.</p>}
          </div>
          <div className="write-character-section">
            <div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium text-[#62656B]">연습 문장</span><span className="tabular-nums text-[#92969D]">{currentIndex + 1} / {WRITING_EXERCISES.length}</span></div>
            <div className="exercise-list" aria-label="문장 진행 상황">
              {WRITING_EXERCISES.map((item, index) => {
                const progress = exerciseCompletion(item, drawings)
                const complete = progress.total > 0 && progress.completed === progress.total
                return <button key={item.id} onClick={() => go(index)} className={`exercise-chip ${index === currentIndex ? 'current' : ''} ${complete ? 'complete' : ''}`}>
                  <span className="exercise-chip-state">{complete ? <Check className="size-3.5" /> : index + 1}</span>
                  <span><strong>{item.title}</strong><small>{progress.completed} / {progress.total} 자모</small></span>
                </button>
              })}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-5">
          <Button variant="secondary" disabled={currentIndex === 0} onClick={() => go(currentIndex - 1)}>이전 문장</Button>
          {currentIndex < WRITING_EXERCISES.length - 1 ? <Button onClick={() => go(currentIndex + 1)}>다음 문장</Button> : <Button onClick={requestGeneration}>폰트 만들기</Button>}
        </div>
        {currentIndex < WRITING_EXERCISES.length - 1 && <Button className="mt-2 w-full" variant="ghost" onClick={requestGeneration}>지금 폰트 만들기</Button>}
        {generatedFont && <Button className="mt-2 w-full" variant="secondary" onClick={() => void (returnGlyph === undefined ? navigate({ to: '/preview' }) : navigate({ to: '/edit', search: { glyph: returnGlyph, query: returnQuery } }))}>기존 폰트 미리보기 · 편집</Button>}
      </aside>

      <section className="sentence-canvas-region">
        <div className="sentence-workspace">
          <div className="sentence-prompt">
            <p>{exercise.title}</p><h1>{exercise.text}</h1>
            <div><span>{exercise.instruction}</span><strong>{exerciseProgress.completed} / {exerciseProgress.total} 자모 수집</strong></div>
          </div>
          <div className="canvas-toolbar" aria-label="그리기 도구와 획 굵기">
            <div className="canvas-tool-buttons" role="group" aria-label="그리기 도구">
              <Button size="sm" variant={tool === 'freedraw' ? 'default' : 'secondary'} onClick={() => setActiveTool('freedraw')}><PenLine className="size-3.5" /> 펜</Button>
              <Button size="sm" variant={tool === 'eraser' ? 'default' : 'secondary'} onClick={() => setActiveTool('eraser')}><Eraser className="size-3.5" /> 지우개</Button>
            </div>
            <span className="canvas-toolbar-divider" aria-hidden="true" />
            <div className="canvas-stroke-control"><span>획 굵기</span><div className="canvas-stroke-slider"><Slider aria-label="획 굵기" min={1} max={5} step={0.1} value={[strokeWidth]} onValueChange={([value]) => setStrokeWidth(value)} /></div><span className="canvas-stroke-value">{strokeWidth.toFixed(1)}</span></div>
            <div className="canvas-stroke-control"><span>손떨림 보정</span><div className="canvas-stroke-slider"><Slider aria-label="손떨림 보정" min={0} max={1} step={0.01} value={[endpointStabilization]} onValueChange={([value]) => projectActions.updateCompositionSettings({ endpointStabilization: value })} /></div><span className="canvas-stroke-value">{endpointStabilization.toFixed(2)}</span></div>
            <span className="canvas-toolbar-divider" aria-hidden="true" />
            <div className="canvas-history-buttons">
              <Button aria-label="실행 취소" size="icon" variant="ghost" onClick={() => api.current?.undo()}><Undo2 className="size-4" /></Button>
              <Button aria-label="다시 실행" size="icon" variant="ghost" onClick={() => api.current?.redo()}><Redo2 className="size-4" /></Button>
              <Button aria-label="문장 모두 지우기" size="icon" variant="ghost" onClick={clear}><RotateCcw className="size-4" /></Button>
            </div>
          </div>
          <div className="sentence-canvas-scroll" ref={canvasViewport}>
            <div className="sentence-canvas-frame" data-testid="writing-canvas" data-cell-size={cellSize} data-columns={activeColumns} data-rows={rowCount} data-assignment-prompts={capture.assignments.map((item) => item.promptId).join(',')} style={{ width: canvasWidth, height: canvasHeight }}>
              <FixedCaptureLayer exercise={exercise} drawings={drawings} sessions={sessions} settings={compositionSettings} cellSize={cellSize} columns={activeColumns} width={canvasWidth} height={canvasHeight} />
              <div className="writing-grid" aria-hidden="true">
                {exercise.cells.map((cell, index) => <div key={index} data-source-cell={sourceExerciseId === exercise.id && sourceCellIndex === index ? 'true' : undefined} className={sourceExerciseId === exercise.id && sourceCellIndex === index ? 'source-cell-highlight' : undefined} style={{ width: cellSize }}><span>{cell.char}</span></div>)}
              </div>
              <WritingSurface key={exercise.id} ref={api} initialElements={(savedSession?.elements ?? []) as unknown as RawStroke[]} cellSize={cellSize} width={canvasWidth} height={canvasHeight} strokeWidth={strokeWidth} endpointStabilization={endpointStabilization} tool={tool} onChange={(elements) => saveElements(elements)} />
            </div>
          </div>
          <div className={`jamo-boundary-controls ${activeCell ? 'is-active' : ''}`} aria-label="수동 자모 경계">
            <div>
              <strong>{activeCell ? `${activeCell.char}의 자모 경계` : '자모 경계 직접 지정'}</strong>
              <span>{activeTarget ? `${roleLabel} ${activeTarget.slot.char}${componentLabel} 획을 모두 쓴 뒤 완료해 주세요.` : activeCell ? '이 칸의 자모 경계가 모두 확정됐어요.' : '획을 시작하면 현재 자모를 바로 완료할 수 있어요.'}</span>
              {boundaryWarning && <small role="alert">{boundaryWarning}</small>}
            </div>
            <div>
              <Button variant="secondary" disabled={!activeBoundaries.length} onClick={undoActiveBoundary}>경계 되돌리기</Button>
              <Button disabled={!canCompleteTarget} onClick={completeActiveTarget}>
                {activeTarget && activeCell ? `${activeCell.char} · ${roleLabel} ${activeTarget.slot.char}${componentLabel} 완료` : activeCell ? `${activeCell.char} 완료됨` : '현재 자모 완료'}
              </Button>
            </div>
          </div>
          <div className="capture-strip-wrap">
            <div className="capture-strip-heading"><span>이 문장에서 수집된 자모</span><small>획을 시작한 칸과 작성 순서를 기준으로 자동 분리됩니다.</small></div>
            <div className="capture-strip">
              {capture.groups.filter((group) => group.elements.length > 0).map((group) => {
                const slot = group.slot
                const cellX = (group.cellIndex % activeColumns) * cellSize
                const cellY = Math.floor(group.cellIndex / activeColumns) * cellSize
                const paths = pathsFromElements(group.elements, cellSize, cellX, endpointStabilization).map((path) => ({ ...path, y: path.y - cellY }))
                return <div className="capture-card" key={`${group.cellIndex}-${group.slotIndex}`}><div dangerouslySetInnerHTML={{ __html: previewFromPaths(paths) }} /><span>{exercise.cells[group.cellIndex].char} · {slot.char}</span><small>{slot.role === 'initial' ? '초성' : slot.role === 'medial' ? '중성' : slot.role === 'final' ? '종성' : '글자'}</small></div>
              })}
              {!capture.groups.some((group) => group.elements.length > 0) && <p className="capture-empty">첫 글자의 첫 획부터 시작해 보세요. 작성한 자모가 여기에 차례로 나타납니다.</p>}
            </div>
          </div>
        </div>
      </section>

      <Dialog open={generationDialog === 'missing'} onOpenChange={(open) => !open && setGenerationDialog(null)}><DialogContent><DialogTitle>아직 수집하지 않은 글자가 있어요</DialogTitle><DialogDescription>기본 글자 {missingBase.length}개, 문맥형 {missingVariants.length}개, 기호 {missingSymbols.length}개가 비어 있습니다. 누락된 기호와 기본 글자는 폰트에 포함하지 않고, 누락된 문맥형은 다른 원본에서 대체합니다.</DialogDescription><div className="mt-4 max-h-24 overflow-y-auto rounded-lg bg-[#F7F8FA] p-3 text-sm leading-6 text-[#62656B]">{remaining.map((item) => item.char).join(' ')}</div><div className="mt-6 flex justify-end gap-2"><DialogClose asChild><Button variant="secondary">계속 작성하기</Button></DialogClose><Button onClick={proceedToGeneration}>그래도 생성하기</Button></div></DialogContent></Dialog>
      <Dialog open={generationDialog === 'conflict'} onOpenChange={(open) => !open && setGenerationDialog(null)}><DialogContent><DialogTitle>기존 글리프 보정을 어떻게 할까요?</DialogTitle><DialogDescription>다시 작성한 원본으로 재합성하면 고급 편집에서 수정한 {modifiedGlyphCount.toLocaleString()}개 글리프의 보정값과 결과가 달라질 수 있습니다.</DialogDescription><div className="mt-6 grid gap-2"><Button onClick={() => void navigate({ to: '/generate' })}>보정 유지하고 재합성</Button><Button variant="destructive" onClick={() => { projectActions.clearGlyphTransformsForRecompose(); void navigate({ to: '/generate' }) }}>기존 보정 삭제 후 재합성</Button><DialogClose asChild><Button variant="ghost">취소</Button></DialogClose></div></DialogContent></Dialog>
    </div>
  )
}
