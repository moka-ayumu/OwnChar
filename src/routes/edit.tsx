import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import opentype from 'opentype.js'
import { ArrowLeft, ChevronRight, PenLine, Redo2, RotateCcw, Save, Undo2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { useFontFace } from '@/hooks/use-font-face'
import { useProject } from '@/hooks/use-project'
import { composeHangulPath, getHangulVariantSelection } from '@/font/hangul'
import type { NormalizedShape } from '@/font/path-geometry'
import { composedHangulPath, hangulComposeOptions, type HangulCompositionInputs } from '@/font/composer'
import { glyphSources } from '@/font/glyph-provenance'
import { composeStandaloneJamoPath, type ReferenceEnvelope } from '@/font/standalone-initial'
import { renderCalibratedGlyph, VISUAL_HANGUL_HEIGHT } from '@/font/visual-calibration'
import { useCompositionContext } from '@/hooks/use-composition-context'
import { CHARACTER_PROMPTS } from '@/lib/prompts'
import { locatePromptSlot, WRITING_EXERCISES } from '@/lib/writing-exercises'
import { cn } from '@/lib/utils'
import { projectActions } from '@/store/project-store'
import { DEFAULT_COMPOSITION_SETTINGS, DEFAULT_GLYPH_OVERRIDE, type CompositionSettings, type DrawingRecord, type GlyphOverride, type WritingSessionRecord } from '@/types/project'

export const Route = createFileRoute('/edit')({
  validateSearch: (search: Record<string, unknown>): { glyph?: number; query?: string } => ({
    glyph: typeof search.glyph === 'number' && Number.isInteger(search.glyph) ? search.glyph : undefined,
    query: typeof search.query === 'string' ? search.query : undefined,
  }),
  component: EditPage,
})

const allCodePoints = [
  ...CHARACTER_PROMPTS.map((prompt) => prompt.codePoint),
  ...Array.from({ length: 11_172 }, (_, index) => 0xac00 + index),
]

function EditPage() {
  const navigate = useNavigate()
  const { glyph, query } = Route.useSearch()
  const initialGlyph = glyph !== undefined && allCodePoints.includes(glyph) ? glyph : undefined
  const buffer = useProject((state) => state.generatedFont)
  const revision = useProject((state) => state.fontRevision)
  const overrides = useProject((state) => state.glyphOverrides)
  const history = useProject((state) => state.history)
  const globalMetrics = useProject((state) => state.globalMetrics)
  const compositionSettings = useProject((state) => state.compositionSettings)
  const drawings = useProject((state) => state.drawings)
  const sessions = useProject((state) => state.writingSessions)
  const fontReady = useFontFace(buffer, revision)
  const [search, setSearch] = useState(query ?? '')
  const [selected, setSelected] = useState<number[]>(() => [initialGlyph ?? 0xac00])
  const [editorMode, setEditorMode] = useState<'glyph' | 'composition'>('glyph')
  const lastSelected = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!buffer) void navigate({ to: '/write' })
  }, [buffer, navigate])

  const visibleCodePoints = useMemo(() => {
    if (!search) return allCodePoints
    const query = [...search][0]
    if (!query) return allCodePoints
    const codePoint = query.codePointAt(0)!
    return allCodePoints.includes(codePoint) ? [codePoint] : []
  }, [search])

  const rows = Math.ceil(visibleCodePoints.length / 10)
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 62,
    overscan: 6,
  })

  const current = selected.length === 1 ? (overrides[selected[0]] ?? DEFAULT_GLYPH_OVERRIDE) : null
  const selectedSources = useMemo(() => selected.length === 1 ? glyphSources(selected[0], drawings) : [], [selected, drawings])

  const selectGlyph = (codePoint: number, event: React.MouseEvent) => {
    if (event.shiftKey && lastSelected.current !== null) {
      const from = allCodePoints.indexOf(lastSelected.current)
      const to = allCodePoints.indexOf(codePoint)
      setSelected(allCodePoints.slice(Math.min(from, to), Math.max(from, to) + 1))
    } else if (event.ctrlKey || event.metaKey) {
      setSelected((value) => value.includes(codePoint) ? value.filter((item) => item !== codePoint) : [...value, codePoint])
    } else {
      setSelected([codePoint])
    }
    lastSelected.current = codePoint
  }

  const apply = (patch: Partial<GlyphOverride>) => projectActions.applyGlyphTransform(selected, patch)

  const fitHeight = () => {
    if (!buffer || !selected.length) return
    const font = opentype.parse(buffer.slice(0))
    const heights = selected.map((codePoint) => {
      const box = font.charToGlyph(String.fromCodePoint(codePoint)).getBoundingBox()
      return Math.max(1, box.y2 - box.y1)
    })
    const max = Math.max(...heights)
    selected.forEach((codePoint, index) => projectActions.applyGlyphTransform([codePoint], { scale: max / heights[index] }))
  }

  if (!buffer) return null

  return (
    <section className="editor-layout">
      <div className="editor-topbar">
        <div className="flex gap-1">
          <Link to="/preview" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}><ArrowLeft className="size-4" /> 미리보기</Link>
          <Link to="/write" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}><PenLine className="size-4" /> 글자 다시 쓰기</Link>
        </div>
        <div className="absolute left-1/2 grid -translate-x-1/2 grid-cols-2 rounded-lg bg-[#F2F4F7] p-1">
          <button className={`rounded-md px-4 py-2 text-xs font-medium ${editorMode === 'glyph' ? 'bg-white text-[#17181A] shadow-sm' : 'text-[#62656B]'}`} onClick={() => setEditorMode('glyph')}>글리프 편집</button>
          <button className={`rounded-md px-4 py-2 text-xs font-medium ${editorMode === 'composition' ? 'bg-white text-[#17181A] shadow-sm' : 'text-[#62656B]'}`} onClick={() => setEditorMode('composition')}>한글 조합 설정</button>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label="실행 취소" disabled={!history.past.length} onClick={projectActions.undo}><Undo2 className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="다시 실행" disabled={!history.future.length} onClick={projectActions.redo}><Redo2 className="size-4" /></Button>
          <Button size="sm" onClick={() => void navigate({ to: '/generate' })}><Save className="size-3.5" /> 변경 적용</Button>
        </div>
      </div>

      {editorMode === 'glyph' ? <div className="editor-body">
        <div className="glyph-browser">
          <div className="border-b border-[#E5E7EB] p-4">
            <input className="text-input" value={search} maxLength={1} placeholder="문자 검색" onChange={(event) => setSearch(event.target.value)} />
            <p className="mt-2 text-xs text-[#92969D]">{selected.length.toLocaleString()}개 선택됨 · Shift/⌘로 다중 선택</p>
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const rowItems = visibleCodePoints.slice(row.index * 10, row.index * 10 + 10)
                return (
                  <div key={row.key} className="grid grid-cols-10 gap-1 px-3" style={{ position: 'absolute', transform: `translateY(${row.start}px)`, width: '100%', height: row.size }}>
                    {rowItems.map((codePoint) => (
                      <button title={overrides[codePoint] ? '고급 편집에서 수정됨' : undefined} key={codePoint} onClick={(event) => selectGlyph(codePoint, event)} className={`glyph-cell ${selected.includes(codePoint) ? 'selected' : ''} ${overrides[codePoint] ? 'modified' : ''}`} style={{ fontFamily: fontReady ? 'OwnCharPreview' : 'inherit' }}>
                        {String.fromCodePoint(codePoint)}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="glyph-preview">
          <span className="text-xs font-medium text-[#92969D]">선택한 글자</span>
          <div className="preview-baseline">
            <span style={{
              fontFamily: fontReady ? 'OwnCharPreview' : 'inherit',
              transform: `translate(${current?.left ?? 0}px, ${-(current?.y ?? 0)}px) scale(${current?.scale ?? 1}) rotate(${current?.rotation ?? 0}deg)`,
            }}>{selected.length === 1 ? String.fromCodePoint(selected[0]) : `${selected.length}자`}</span>
          </div>
        </div>

        <aside className="editor-settings">
          <div className="border-b border-[#EEF0F2] pb-5">
            <h2 className="text-sm font-semibold">원본 필기</h2>
            {selected.length !== 1 ? <p className="mt-2 text-xs text-[#62656B]">글자 하나를 선택하면 출처를 볼 수 있어요.</p>
              : selectedSources.length === 0 ? <p className="mt-2 text-xs text-[#62656B]">작성된 원본이 없습니다.</p>
                : <div className="mt-3 space-y-2">{selectedSources.map((source, index) => {
                  // Records written in a retired exercise open the cell that collects them now.
                  const current = WRITING_EXERCISES.find((item) => item.id === source.capture?.exerciseId)
                  const located = current ? undefined : locatePromptSlot(source.originPromptId)
                  const exercise = current ?? located?.exercise
                  const cellIndex = current ? source.capture?.cellIndex : located?.cellIndex
                  const roleName = source.role === 'initial' ? '초성' : source.role === 'medial' ? '중성' : source.role === 'final' ? '종성' : source.role
                  const role = source.match === 'derived' ? `${roleName} · 다른 문맥에서 파생` : source.match === 'compound' ? `${roleName} · 겹받침 합성` : roleName
                  return exercise && cellIndex !== undefined
                    ? <button key={`${source.originPromptId}-${index}`} className="flex w-full items-center justify-between rounded-lg border border-[#E5E7EB] px-3 py-2 text-left text-xs font-medium hover:border-[#2457F5] hover:text-[#2457F5]" onClick={() => void navigate({ to: '/write', search: { exerciseId: exercise.id, cellIndex, returnGlyph: selected[0], returnQuery: search || undefined } })}>
                      <span>{role} {source.char}</span><ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                    : <div key={`${source.originPromptId}-${index}`} className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs text-[#62656B]">{role} {source.char} · 원본 없음</div>
                })}</div>}
          </div>
          <h2 className="text-sm font-semibold">글리프 설정 {Object.keys(overrides).length ? <span className="font-normal text-[#B45309]">· {Object.keys(overrides).length}개 수정됨</span> : null}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {([
              ['left', '왼쪽 여백'], ['right', '오른쪽 여백'], ['y', '높이'], ['scale', '크기'], ['rotation', '회전'],
            ] as const).map(([key, label]) => (
              <label key={key} className={key === 'rotation' ? 'col-span-2' : ''}>
                <span className="input-label">{label}</span>
                <input type="number" className="text-input mt-1.5" step={key === 'scale' ? 0.05 : 1} min={key === 'scale' ? 0.1 : undefined} value={current ? current[key] : ''} placeholder={current ? undefined : '다름'} onChange={(event) => event.target.value !== '' && apply({ [key]: Number(event.target.value) })} />
              </label>
            ))}
          </div>

          <div className="mt-7 border-t border-[#EEF0F2] pt-6">
            <h3 className="text-sm font-semibold">전체 여백</h3>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {(['left', 'right', 'y'] as const).map((key) => <label key={key}><span className="input-label">{key === 'left' ? '왼쪽' : key === 'right' ? '오른쪽' : '높이'}</span><input type="number" className="text-input mt-1.5" value={globalMetrics[key]} onChange={(event) => projectActions.updateGlobalMetrics({ [key]: Number(event.target.value) })} /></label>)}
            </div>
          </div>

          <div className="mt-7 space-y-2 border-t border-[#EEF0F2] pt-6">
            <Button className="w-full" variant="secondary" onClick={fitHeight}>선택 높이 맞추기</Button>
            <Button className="w-full" variant="ghost" onClick={() => projectActions.resetGlyphTransform(selected)}><RotateCcw className="size-3.5" /> 선택 초기화</Button>
            <Button className="w-full text-[#B42318]" variant="ghost" onClick={projectActions.resetAllGlyphTransforms}>모든 글리프 초기화</Button>
          </div>
        </aside>
      </div> : <CompositionWorkspace drawings={drawings} sessions={sessions} settings={compositionSettings} />}
    </section>
  )
}

const compositionFields: Array<{
  key: 'singleInitialScale' | 'vowelScale' | 'finalScale'
  label: string
  help: string
  min: number
  max: number
  step: number
  suffix: string
}> = [
  { key: 'singleInitialScale', label: '단일 초성 크기', help: 'ㄱ처럼 초성이 하나일 때 차지하는 비율', min: 0.5, max: 1.2, step: 0.05, suffix: '×' },
  { key: 'vowelScale', label: '모음 크기', help: '음절 안에서 모음이 차지하는 비율', min: 0.5, max: 1.2, step: 0.05, suffix: '×' },
  { key: 'finalScale', label: '받침 크기', help: '단일·겹받침이 받침 영역에서 차지하는 비율', min: 0.5, max: 1.2, step: 0.05, suffix: '×' },
]

const compositionExamples = [
  { char: '가', label: '세로 모음 · 받침 없음' },
  { char: '각', label: '세로 모음 · 단일 받침' },
  { char: '갃', label: '세로 모음 · 겹받침 ㄳ' },
  { char: '까', label: '겹초성 ㄲ' },
  { char: '고', label: '가로 모음 · 받침 없음' },
  { char: '곡', label: '가로 모음 · 받침 있음' },
  { char: '과', label: '혼합 모음 ㅘ' },
  { char: '곽', label: '혼합 모음 · 받침 있음' },
  { char: '괘', label: '복합 모음 ㅙ' },
  { char: '좋', label: '가로 모음 · 자연스러운 겹침' },
  { char: '루', label: '가로 모음 · 가운데 정렬' },
]

function CompositionWorkspace({ drawings, sessions, settings }: {
  drawings: Record<string, DrawingRecord>
  sessions: Record<string, WritingSessionRecord>
  settings: CompositionSettings
}) {
  const { shapes, composition, visualScale } = useCompositionContext(drawings, sessions, settings)
  const jamoReference = useMemo<ReferenceEnvelope>(() => {
    const path = composeHangulPath('가'.codePointAt(0)!, shapes, settings, hangulComposeOptions(composition))
    if (!path.commands.length) return { width: VISUAL_HANGUL_HEIGHT / visualScale, height: VISUAL_HANGUL_HEIGHT / visualScale, centerX: 500, centerY: composition.hangulTargetCenter }
    const box = path.getBoundingBox()
    return { width: box.x2 - box.x1, height: box.y2 - box.y1, centerX: (box.x1 + box.x2) / 2, centerY: (box.y1 + box.y2) / 2 }
  }, [shapes, settings, composition, visualScale])

  return (
    <div className="composition-workspace">
      <main className="composition-preview-area">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-xs font-medium text-[#2457F5]">실시간 조합 미리보기</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">대표 음절로 조합 균형을 확인하세요.</h1>
            <p className="mt-2 text-sm text-[#62656B]">전체 폰트를 재생성하지 않고 현재 자모와 설정만 Canvas에 조합합니다.</p>
          </div>
          <p className="shrink-0 text-xs text-[#92969D]">기본형과 입력된 문맥형을 즉시 반영</p>
        </div>
        <div className="composition-example-grid">
          <StandaloneJamoCanvas char="ㅇ" shape={shapes.get('ㅇ')} settings={settings} reference={jamoReference} visualScale={visualScale} />
          <StandaloneJamoCanvas char="ㅜ" shape={shapes.get('ㅜ')} settings={settings} reference={jamoReference} visualScale={visualScale} />
          {compositionExamples.map((example) => <CompositionCanvas key={example.char} {...example} shapes={shapes} composition={composition} visualScale={visualScale} />)}
        </div>
      </main>
      <aside className="composition-control-panel">
        <CompositionControls settings={settings} />
      </aside>
    </div>
  )
}

function drawCompositionPreview(canvas: HTMLCanvasElement, path: opentype.Path) {
  const dpr = window.devicePixelRatio || 1
  const size = 240
  canvas.width = size * dpr
  canvas.height = size * dpr
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, size, size)
  context.strokeStyle = '#E5E7EB'
  context.lineWidth = 1
  context.strokeRect(20.5, 20.5, 199, 199)
  context.setLineDash([3, 4])
  context.beginPath()
  context.moveTo(20, 210.5)
  context.lineTo(220, 210.5)
  context.stroke()
  context.setLineDash([])

  context.save()
  context.translate(20, 210)
  context.scale(0.2, -0.2)
  context.fillStyle = '#17181A'
  context.beginPath()
  for (const command of path.commands) {
    if (command.type === 'M') context.moveTo(command.x, command.y)
    else if (command.type === 'L') context.lineTo(command.x, command.y)
    else if (command.type === 'C') context.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y)
    else if (command.type === 'Q') context.quadraticCurveTo(command.x1, command.y1, command.x, command.y)
    else if (command.type === 'Z') context.closePath()
  }
  context.fill()
  context.restore()
}

function StandaloneJamoCanvas({ char, shape, settings, reference, visualScale }: {
  char: string
  shape?: NormalizedShape
  settings: CompositionSettings
  reference: ReferenceEnvelope
  visualScale: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvasRef.current) return
    const path = renderCalibratedGlyph(
      (penScale) => shape ? composeStandaloneJamoPath(shape, settings, reference, penScale) : new opentype.Path(),
      visualScale, reference.centerY, 450, settings.widthMode === 'fixed',
    )
    drawCompositionPreview(canvasRef.current, path)
  }, [shape, settings, reference, visualScale])
  return <figure className="composition-example-card">
    <canvas ref={canvasRef} className="w-full" style={{ aspectRatio: '1' }} aria-label={`${char} 단독 자모 미리보기`} />
    <figcaption className="flex items-baseline justify-between gap-3 border-t border-[#EEF0F2] px-4 py-3">
      <strong className="text-xl font-semibold">{char}</strong>
      <span className="text-right text-[11px] leading-4 text-[#92969D]">단독 자모 · 가 기준 {Math.round(settings.standaloneJamoMaxHeight * 100)}%</span>
    </figcaption>
  </figure>
}

function CompositionCanvas({ char, label, shapes, composition, visualScale }: {
  char: string
  label: string
  shapes: Map<string, NormalizedShape>
  composition: HangulCompositionInputs
  visualScale: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const codePoint = char.codePointAt(0)!
  const variants = getHangulVariantSelection(codePoint)
  const hasFinal = (codePoint - 0xac00) % 28 > 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    drawCompositionPreview(canvas, composedHangulPath(codePoint, shapes, composition, visualScale))
  }, [codePoint, shapes, composition, visualScale])

  return (
    <figure className="composition-example-card">
      <canvas ref={canvasRef} className="w-full" style={{ aspectRatio: '1' }} aria-label={`${char} 조합 미리보기`} />
      <figcaption className="flex items-baseline justify-between gap-3 border-t border-[#EEF0F2] px-4 py-3">
        <div><strong className="text-xl font-semibold">{char}</strong><p className="mt-1 text-[10px] text-[#B45309]">초 {variants.initial + 1}벌 · 중 {variants.medial + 1}벌{hasFinal ? ` · 종 ${variants.final + 1}벌` : ''}</p></div>
        <span className="text-right text-[11px] leading-4 text-[#92969D]">{label}</span>
      </figcaption>
    </figure>
  )
}

function CompositionControls({ settings }: { settings: CompositionSettings }) {
  const normalizationFields = [
    ['hangulNormalization', '한글 음절 정규화'],
    ['jamoNormalization', '자모 정규화'],
    ['latinNormalization', '영문 정규화'],
  ] as const
  return (
    <div>
      <h2 className="text-sm font-semibold">한글 조합 설정</h2>
      <p className="mt-2 text-xs leading-5 text-[#62656B]">왼쪽 예시는 즉시 갱신됩니다. 실제 OTF에는 상단의 변경 적용을 눌러 재합성할 때 반영됩니다.</p>
      <div className="mt-5 space-y-5">
        {compositionFields.map((field) => (
          <label key={field.key} className="block">
            <span className="flex items-center justify-between gap-3">
              <span className="input-label">{field.label}</span>
              <span className="flex items-center gap-1"><input aria-label={field.label} type="number" className="text-input h-8 w-20 py-1 text-right" min={field.min} max={field.max} step={field.step} value={settings[field.key]} onChange={(event) => projectActions.updateCompositionSettings({ [field.key]: Number(event.target.value) })} /><span className="w-4 text-xs text-[#92969D]">{field.suffix}</span></span>
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-[#92969D]">{field.help}</span>
          </label>
        ))}
      </div>
      <div className="mt-6 border-t border-[#EEF0F2] pt-5">
        <h3 className="text-sm font-semibold">손떨림 보정</h3>
        <p className="mt-1 text-[11px] leading-4 text-[#92969D]">0은 원본 획, 1은 획의 떨림과 시작·끝의 갈고리를 최대로 보정합니다. 모서리는 유지됩니다.</p>
        <label className="mt-4 block">
          <span className="flex items-center justify-between text-xs"><span>손떨림 보정 강도</span><span className="tabular-nums">{settings.endpointStabilization.toFixed(2)}</span></span>
          <input aria-label="손떨림 보정 강도" type="range" min="0" max="1" step="0.01" value={settings.endpointStabilization} className="mt-2 w-full accent-[#2457F5]" onChange={(event) => projectActions.updateCompositionSettings({ endpointStabilization: Number(event.target.value) })} />
        </label>
      </div>
      <div className="mt-6 border-t border-[#EEF0F2] pt-5">
        <h3 className="text-sm font-semibold">크기 정규화</h3>
        <p className="mt-1 text-[11px] leading-4 text-[#92969D]">0은 원본 크기, 1은 완성된 필기의 대표 크기에 가장 가깝게 맞춥니다.</p>
        <div className="mt-4 space-y-4">
          {normalizationFields.map(([key, label]) => (
            <label key={key} className="block">
              <span className="flex items-center justify-between text-xs"><span>{label}</span><span className="tabular-nums">{settings[key].toFixed(2)}</span></span>
              <input aria-label={label} type="range" min="0" max="1" step="0.01" value={settings[key]} className="mt-2 w-full accent-[#2457F5]" onChange={(event) => projectActions.updateCompositionSettings({ [key]: Number(event.target.value) })} />
            </label>
          ))}
        </div>
      </div>
      <div className="mt-6 border-t border-[#EEF0F2] pt-5">
        <h3 className="text-sm font-semibold">단독 자모 크기</h3>
        <p className="mt-1 text-[11px] leading-4 text-[#92969D]">자음·모음 한 글자를 현재 프로젝트의 ‘가’ 잉크 폭과 높이 안에 같은 비율로 맞춥니다.</p>
        <label className="mt-4 block">
          <span className="flex items-center justify-between text-xs"><span>단독 자모 크기 비율</span><span className="tabular-nums">{Math.round(settings.standaloneJamoMaxHeight * 100)}%</span></span>
          <input aria-label="단독 자모 크기 비율" type="range" min="0.1" max="1" step="0.01" value={settings.standaloneJamoMaxHeight} className="mt-2 w-full accent-[#2457F5]" onChange={(event) => projectActions.updateCompositionSettings({ standaloneJamoMaxHeight: Number(event.target.value) })} />
        </label>
      </div>
      <div className="mt-6 border-t border-[#EEF0F2] pt-5">
        <h3 className="text-sm font-semibold">수직 가운데 정렬</h3>
        <p className="mt-1 text-[11px] leading-4 text-[#92969D]">문자 역할별 기준 높이에 맞춥니다. 기호는 별도 규칙을 사용합니다.</p>
        <label className="mt-4 block">
          <span className="flex items-center justify-between text-xs"><span>수직 정렬</span><span className="tabular-nums">{settings.verticalAlignment.toFixed(2)}</span></span>
          <input aria-label="수직 정렬" type="range" min="0" max="1" step="0.01" value={settings.verticalAlignment} className="mt-2 w-full accent-[#2457F5]" onChange={(event) => projectActions.updateCompositionSettings({ verticalAlignment: Number(event.target.value) })} />
        </label>
      </div>
      <div className="mt-6 border-t border-[#EEF0F2] pt-5">
        <h3 className="text-sm font-semibold">글자 가로폭</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['proportional', 'fixed'] as const).map((mode) => <button key={mode} type="button" aria-pressed={settings.widthMode === mode} className={`rounded-md border px-3 py-2 text-xs ${settings.widthMode === mode ? 'border-[#2457F5] bg-[#EFF4FF] text-[#2457F5]' : 'border-[#E5E7EB]'}`} onClick={() => projectActions.updateCompositionSettings({ widthMode: mode })}>{mode === 'proportional' ? '가변 폭' : '고정 폭'}</button>)}
        </div>
      </div>
      <Button className="mt-6 w-full" variant="secondary" onClick={() => projectActions.updateCompositionSettings(DEFAULT_COMPOSITION_SETTINGS)}><RotateCcw className="size-3.5" /> 조합 기본값 복원</Button>
    </div>
  )
}
