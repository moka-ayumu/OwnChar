import type { WritingCell } from '@/collection/exercises'
import { ROLE_LABELS } from '@/collection/prompts'
import { Button } from '@/components/ui/button'
import type { IndexedSlot } from './stroke-assignment'

/** Lets the writer end the current jamo by hand when the automatic stroke count would split it wrongly. */
export function BoundaryControls({ cell, target, warning, canUndo, canComplete, onUndo, onComplete }: {
  /** The cell being written, if any. */
  cell: WritingCell | null
  /** The jamo of that cell still open, if any. */
  target: IndexedSlot | undefined
  warning: string
  canUndo: boolean
  canComplete: boolean
  onUndo(): void
  onComplete(confirmedAt: number): void
}) {
  const jamo = target ? `${target.slot.role ? ROLE_LABELS[target.slot.role] : '글자'} ${target.slot.char}` : ''
  return (
    <div className={`jamo-boundary-controls ${cell ? 'is-active' : ''}`} aria-label="수동 자모 경계">
      <div>
        <strong>{cell ? `${cell.char}의 자모 경계` : '자모 경계 직접 지정'}</strong>
        <span>{target ? `${jamo} 획을 모두 쓴 뒤 완료해 주세요.` : cell ? '이 칸의 자모 경계가 모두 확정됐어요.' : '획을 시작하면 현재 자모를 바로 완료할 수 있어요.'}</span>
        {warning && <small role="alert">{warning}</small>}
      </div>
      <div>
        <Button variant="secondary" disabled={!canUndo} onClick={onUndo}>경계 되돌리기</Button>
        <Button disabled={!canComplete} onClick={(event) => onComplete(event.timeStamp)}>
          {target && cell ? `${cell.char} · ${jamo} 완료` : cell ? `${cell.char} 완료됨` : '현재 자모 완료'}
        </Button>
      </div>
    </div>
  )
}
