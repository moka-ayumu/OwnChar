import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import opentype from 'opentype.js'
import { ArrowLeft, ChevronRight, PenLine, Redo2, RotateCcw, Save, Undo2 } from 'lucide-react'
import { WRITING_EXERCISES } from '@/collection/exercises'
import { BASE_CHARACTER_PROMPTS, ROLE_LABELS } from '@/collection/prompts'
import { Button, buttonVariants } from '@/components/ui/button'
import { HANGUL_BASE, HANGUL_COUNT } from '@/font/hangul'
import { glyphSources, type GlyphSource } from '@/generation/provenance'
import { DEFAULT_GLYPH_OVERRIDE, type GlyphOverride } from '@/generation/request'
import { useFontFace } from '@/lib/use-font-face'
import { cn } from '@/lib/utils'
import { projectActions } from '@/project/store'
import { useProject } from '@/project/use-project'
import { CompositionWorkspace } from './composition-workspace'

export interface EditSearch {
  /** The glyph to select on arrival. */
  glyph?: number
  query?: string
}

const COLUMNS = 10

const allCodePoints = [
  ...BASE_CHARACTER_PROMPTS.map((prompt) => prompt.codePoint),
  ...Array.from({ length: HANGUL_COUNT }, (_, index) => HANGUL_BASE + index),
]

const overrideFields = [['left', '왼쪽 여백'], ['right', '오른쪽 여백'], ['y', '높이'], ['scale', '크기'], ['rotation', '회전']] as const
const metricFields = [['left', '왼쪽'], ['right', '오른쪽'], ['y', '높이']] as const

function sourceLabel(source: GlyphSource) {
  const name = source.symbol ? '기호' : source.role ? ROLE_LABELS[source.role] : '글자'
  return source.match === 'derived' ? `${name} · 다른 문맥에서 파생` : source.match === 'compound' ? `${name} · 겹받침 합성` : name
}

export function EditPage({ glyph, query }: EditSearch) {
  const navigate = useNavigate()
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
  const [selected, setSelected] = useState<number[]>(() => [glyph !== undefined && allCodePoints.includes(glyph) ? glyph : HANGUL_BASE])
  const [editorMode, setEditorMode] = useState<'glyph' | 'composition'>('glyph')
  const lastSelected = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!buffer) void navigate({ to: '/write' })
  }, [buffer, navigate])

  const visibleCodePoints = useMemo(() => {
    const codePoint = [...search][0]?.codePointAt(0)
    if (codePoint === undefined) return allCodePoints
    return allCodePoints.includes(codePoint) ? [codePoint] : []
  }, [search])

  const virtualizer = useVirtualizer({
    count: Math.ceil(visibleCodePoints.length / COLUMNS),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 62,
    overscan: 6,
  })

  const current = selected.length === 1 ? (overrides[selected[0]] ?? DEFAULT_GLYPH_OVERRIDE) : null
  const selectedSources = useMemo(() => selected.length === 1 ? glyphSources(selected[0], drawings) : [], [selected, drawings])
  const overrideCount = Object.keys(overrides).length
  const previewFont = fontReady ? 'OwnCharPreview' : 'inherit'

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

  /** Scales every selected glyph to the height of the tallest one. */
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
          {([['glyph', '글리프 편집'], ['composition', '한글 조합 설정']] as const).map(([mode, label]) => (
            <button key={mode} className={`rounded-md px-4 py-2 text-xs font-medium ${editorMode === mode ? 'bg-white text-[#17181A] shadow-sm' : 'text-[#62656B]'}`} onClick={() => setEditorMode(mode)}>{label}</button>
          ))}
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
              {virtualizer.getVirtualItems().map((row) => (
                <div key={row.key} className="grid grid-cols-10 gap-1 px-3" style={{ position: 'absolute', transform: `translateY(${row.start}px)`, width: '100%', height: row.size }}>
                  {visibleCodePoints.slice(row.index * COLUMNS, row.index * COLUMNS + COLUMNS).map((codePoint) => (
                    <button title={overrides[codePoint] ? '고급 편집에서 수정됨' : undefined} key={codePoint} onClick={(event) => selectGlyph(codePoint, event)} className={`glyph-cell ${selected.includes(codePoint) ? 'selected' : ''} ${overrides[codePoint] ? 'modified' : ''}`} style={{ fontFamily: previewFont }}>
                      {String.fromCodePoint(codePoint)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glyph-preview">
          <span className="text-xs font-medium text-[#92969D]">선택한 글자</span>
          <div className="preview-baseline">
            <span style={{
              fontFamily: previewFont,
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
                  const capture = source.capture
                  const label = `${sourceLabel(source)} ${source.char}`
                  return capture && WRITING_EXERCISES.some((item) => item.id === capture.exerciseId)
                    ? <button key={`${source.originPromptId}-${index}`} className="flex w-full items-center justify-between rounded-lg border border-[#E5E7EB] px-3 py-2 text-left text-xs font-medium hover:border-[#2457F5] hover:text-[#2457F5]" onClick={() => void navigate({ to: '/write', search: { exerciseId: capture.exerciseId, cellIndex: capture.cellIndex, returnGlyph: selected[0], returnQuery: search || undefined } })}>
                      <span>{label}</span><ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                    : <div key={`${source.originPromptId}-${index}`} className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs text-[#62656B]">{label} · 원본 없음</div>
                })}</div>}
          </div>
          <h2 className="text-sm font-semibold">글리프 설정 {overrideCount ? <span className="font-normal text-[#B45309]">· {overrideCount}개 수정됨</span> : null}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {overrideFields.map(([key, label]) => (
              <label key={key} className={key === 'rotation' ? 'col-span-2' : ''}>
                <span className="input-label">{label}</span>
                <input type="number" className="text-input mt-1.5" step={key === 'scale' ? 0.05 : 1} min={key === 'scale' ? 0.1 : undefined} value={current ? current[key] : ''} placeholder={current ? undefined : '다름'} onChange={(event) => event.target.value !== '' && projectActions.applyGlyphTransform(selected, { [key]: Number(event.target.value) } as Partial<GlyphOverride>)} />
              </label>
            ))}
          </div>

          <div className="mt-7 border-t border-[#EEF0F2] pt-6">
            <h3 className="text-sm font-semibold">전체 여백</h3>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {metricFields.map(([key, label]) => <label key={key}><span className="input-label">{label}</span><input type="number" className="text-input mt-1.5" value={globalMetrics[key]} onChange={(event) => projectActions.updateGlobalMetrics({ [key]: Number(event.target.value) })} /></label>)}
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
