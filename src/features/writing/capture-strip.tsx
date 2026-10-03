import type { WritingExercise } from '@/collection/exercises'
import { ROLE_LABELS } from '@/collection/prompts'
import { previewSvg, strokePaths, type CanvasGrid, type CaptureGroup } from './stroke-assignment'

/** The jamo collected from the sentence so far, in writing order. */
export function CaptureStrip({ exercise, groups, grid, endpointStabilization }: {
  exercise: WritingExercise
  groups: CaptureGroup[]
  grid: CanvasGrid
  endpointStabilization: number
}) {
  const written = groups.filter((group) => group.strokes.length > 0)
  return (
    <div className="capture-strip-wrap">
      <div className="capture-strip-heading"><span>이 문장에서 수집된 자모</span><small>획을 시작한 칸과 작성 순서를 기준으로 자동 분리됩니다.</small></div>
      <div className="capture-strip">
        {written.map((group) => (
          <div className="capture-card" key={`${group.cellIndex}-${group.slotIndex}`}>
            <div dangerouslySetInnerHTML={{ __html: previewSvg(strokePaths(group, grid, endpointStabilization)) }} />
            <span>{exercise.cells[group.cellIndex].char} · {group.slot.char}</span>
            <small>{group.slot.role ? ROLE_LABELS[group.slot.role] : '글자'}</small>
          </div>
        ))}
        {!written.length && <p className="capture-empty">첫 글자의 첫 획부터 시작해 보세요. 작성한 자모가 여기에 차례로 나타납니다.</p>}
      </div>
    </div>
  )
}
