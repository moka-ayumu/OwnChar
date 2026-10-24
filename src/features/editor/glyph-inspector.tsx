import { useMemo, useState } from 'react'
import { ChevronRight, RotateCcw } from 'lucide-react'
import { WRITING_EXERCISES } from '@/collection/exercises'
import { ROLE_LABELS } from '@/collection/prompts'
import { Hint } from '@/components/hint'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DEFAULT_GLYPH_OVERRIDE, type GlyphOverride } from '@/generation/request'
import type { GlyphSource } from '@/generation/provenance'
import { projectActions } from '@/project/store'
import { NumberField } from './number-field'

const glyphFields = [['left', '왼쪽 여백'], ['right', '오른쪽 여백'], ['y', '높이'], ['scale', '크기'], ['rotation', '회전']] as const
const metricFields = [['left', '왼쪽'], ['right', '오른쪽'], ['y', '높이']] as const

function sourceLabel(source: GlyphSource) {
  const name = source.symbol ? '기호' : source.role ? ROLE_LABELS[source.role] : '글자'
  return source.match === 'derived' ? `${name} · 다른 문맥에서 파생` : source.match === 'compound' ? `${name} · 자모 합성` : name
}

/** The values of the selected glyphs, the sources of one glyph, and the values that apply to every glyph. */
export function GlyphInspector({ selected, overrides, globalMetrics, sources, onOpenSource, onFitHeight }: {
  selected: number[]
  overrides: Record<number, GlyphOverride>
  globalMetrics: { left: number; right: number; y: number }
  sources: GlyphSource[]
  onOpenSource(capture: NonNullable<GlyphSource['capture']>): void
  onFitHeight(): void
}) {
  const [askReset, setAskReset] = useState(false)
  const overrideCount = Object.keys(overrides).length
  const single = selected.length === 1
  const common = useMemo(() => Object.fromEntries(glyphFields.map(([key]) => {
    const first = overrides[selected[0]]?.[key] ?? DEFAULT_GLYPH_OVERRIDE[key]
    return [key, selected.every((codePoint) => (overrides[codePoint]?.[key] ?? DEFAULT_GLYPH_OVERRIDE[key]) === first) ? first : undefined]
  })) as Record<keyof GlyphOverride, number | undefined>, [selected, overrides])
  const apply = (patch: Partial<GlyphOverride>) => projectActions.applyGlyphTransform(selected, patch)

  return (
    <aside className="edit-inspector" aria-label="글리프 설정">
      <section>
        <h2 className="text-sm font-bold">선택한 글자</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {glyphFields.map(([key, label]) => (
            <NumberField key={key} label={label} value={common[key]} step={key === 'scale' ? 0.05 : 1} min={key === 'scale' ? 0.1 : undefined} onCommit={(value) => apply({ [key]: value })} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Hint className="block" side="bottom" label="선택한 글자를 가장 높은 글자에 맞춥니다">
            <Button className="w-full" variant="secondary" size="sm" disabled={selected.length < 2} onClick={onFitHeight}>높이 맞추기</Button>
          </Hint>
          <Button variant="ghost" size="sm" disabled={!selected.some((codePoint) => overrides[codePoint])} onClick={() => projectActions.resetGlyphTransform(selected)}><RotateCcw className="size-3.5" /> 선택 초기화</Button>
        </div>
      </section>

      <section className="edit-group">
        <Hint className="block" side="left" label={single ? undefined : '글자 하나를 선택하면 출처를 볼 수 있습니다.'}>
          <h2 className="text-sm font-bold">원본 필기</h2>
          {single && (sources.length === 0 ? <p className="mt-2 text-xs text-ink-2">원본 없음</p> : (
            <div className="mt-3 space-y-2">
              {sources.map((source, index) => {
                const capture = source.capture
                const label = `${sourceLabel(source)} ${source.char}`
                return capture && WRITING_EXERCISES.some((item) => item.id === capture.exerciseId)
                  ? <button key={`${source.originPromptId}-${index}`} type="button" className="source-link" onClick={() => onOpenSource(capture)}><span>{label}</span><ChevronRight className="size-4" aria-hidden="true" /></button>
                  : <div key={`${source.originPromptId}-${index}`} className="rounded-md border border-rule px-3 py-2 text-sm text-ink-2">{label} · 원본 없음</div>
              })}
            </div>
          ))}
        </Hint>
      </section>

      <section className="edit-group">
        <h2 className="text-sm font-bold">전체 여백</h2>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {metricFields.map(([key, label]) => <NumberField key={key} label={label} value={globalMetrics[key]} onCommit={(value) => projectActions.updateGlobalMetrics({ [key]: value })} />)}
        </div>
      </section>

      <section className="edit-group">
        <Button className="w-full" variant="destructive" size="sm" disabled={!overrideCount} onClick={() => setAskReset(true)}>모든 글리프 초기화</Button>
      </section>

      <Dialog open={askReset} onOpenChange={setAskReset}>
        <DialogContent>
          <DialogTitle>모든 글리프의 보정값을 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>{overrideCount.toLocaleString()}개 글리프의 보정값이 삭제됩니다. 실행 취소로 되돌릴 수 있습니다.</DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAskReset(false)}>취소</Button>
            <Button variant="destructive" onClick={() => { projectActions.resetAllGlyphTransforms(); setAskReset(false) }}>삭제</Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
