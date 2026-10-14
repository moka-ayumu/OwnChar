import { Check, X } from 'lucide-react'
import type { WritingCell } from '@/collection/exercises'
import { ROLE_LABELS } from '@/collection/prompts'
import { Button } from '@/components/ui/button'
import type { CanvasGrid, SlotProgress } from './stroke-assignment'

const slotName = ({ slot }: SlotProgress) => `${slot.role ? ROLE_LABELS[slot.role] : '글자'} ${slot.char}`

/**
 * Beside the cell being written: the jamo it collects, which one the strokes
 * go to now, and how many strokes that one usually still takes. The writer
 * can end it early, or move collection to another jamo of the cell.
 */
export function CellPopover({ cell, cellIndex, grid, slots, current, remaining, canFinish, reopened, warning, onCollect, onFinish, onClose }: {
  cell: WritingCell
  cellIndex: number
  grid: CanvasGrid
  slots: SlotProgress[]
  /** Position in `slots` of the jamo being written; null when all are collected. */
  current: number | null
  remaining: number
  canFinish: boolean
  reopened: boolean
  warning: string
  onCollect(index: number): void
  onFinish(): void
  onClose(): void
}) {
  const column = cellIndex % grid.columns
  const top = Math.floor(cellIndex / grid.columns) * grid.cellSize
  // It opens to the right of the cell; in the last column there is no room, so it opens to the left.
  const flipped = grid.columns > 1 && column === grid.columns - 1
  // A single column leaves no room at either side, so it opens under the cell.
  const below = grid.columns === 1
  const position = below ? { left: 0, top: top + grid.cellSize } : flipped ? { top, right: (grid.columns - column) * grid.cellSize } : { top, left: (column + 1) * grid.cellSize }
  const target = current === null ? undefined : slots[current]
  // A jamo can take over only when every jamo before it has a stroke to end on.
  const reachable = (index: number) => slots.slice(0, index).every((slot) => slot.count > 0)

  return (
    <div className={`cell-popover ${below ? 'is-below' : flipped ? 'is-flipped' : ''}`} style={position} role="group" aria-label={`${cell.char} 칸 자모 수집`} data-testid="cell-popover">
      <div className="cell-popover-tabs" role="group" aria-label="수집할 자모">
        {slots.map((slot, index) => (
          <button key={slot.slotIndex} type="button" aria-pressed={index === current} aria-label={slotName(slot)} title={slotName(slot)} disabled={index !== current && !reachable(index)} className={slot.done ? 'is-done' : undefined} onClick={() => onCollect(index)}>
            {slot.slot.char}
            {slot.done && <Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" />}
          </button>
        ))}
        {reopened && <button type="button" className="cell-popover-close" aria-label="닫기" title="닫기" onClick={onClose}><X className="size-3.5" /></button>}
      </div>
      {target ? (
        <>
          <p className="cell-popover-count" aria-live="polite">
            <span>{slotName(target)}</span>
            {remaining > 0 ? <strong>남은 획 <b>{remaining}</b></strong> : <strong>다 썼으면 완료해 주세요</strong>}
          </p>
          <Button className="w-full" size="sm" variant="secondary" disabled={!canFinish} onClick={onFinish}>{target.slot.char} 완료</Button>
        </>
      ) : (
        <p className="cell-popover-count"><span>{cell.char}</span><strong>수집 완료</strong></p>
      )}
      {warning && <small role="alert">{warning}</small>}
    </div>
  )
}
