import { memo, useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, Redo2, SlidersHorizontal, SquareDashed, Trash2, Undo2 } from 'lucide-react'
import { Hint } from '@/components/hint'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

export type CanvasTool = 'pen' | 'eraser'

/** The writing tools, as icons in a column that stays beside the canvas while it scrolls. */
export const ToolRail = memo(function ToolRail({ tool, strokeWidth, endpointStabilization, showHints, cellSize, cellSizeLocked, onTool, onStrokeWidth, onEndpointStabilization, onToggleHints, onCellSize, onUndo, onRedo, onClear }: {
  tool: CanvasTool
  strokeWidth: number
  endpointStabilization: number
  showHints: boolean
  cellSize: number
  /** The cell size can change only while nothing is written. */
  cellSizeLocked: boolean
  onTool(tool: CanvasTool): void
  onStrokeWidth(value: number): void
  onEndpointStabilization(value: number): void
  onToggleHints(): void
  onCellSize(value: number): void
  onUndo(): void
  onRedo(): void
  onClear(): void
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settings = useRef<HTMLDivElement>(null)

  // The settings close on a press anywhere else, so writing never has to dismiss them first.
  useEffect(() => {
    if (!settingsOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!settings.current?.contains(event.target as Node)) setSettingsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsOpen])

  return (
    <div className="tool-rail" role="toolbar" aria-orientation="vertical" aria-label="쓰기 도구">
      <Button size="icon" variant={tool === 'pen' ? 'default' : 'ghost'} aria-pressed={tool === 'pen'} aria-label="펜" title="펜" onClick={() => onTool('pen')}><PenLine className="size-[18px]" /></Button>
      <Button size="icon" variant={tool === 'eraser' ? 'default' : 'ghost'} aria-pressed={tool === 'eraser'} aria-label="지우개" title="지우개" onClick={() => onTool('eraser')}><Eraser className="size-[18px]" /></Button>
      <span className="tool-rail-divider" aria-hidden="true" />
      <Button size="icon" variant="ghost" aria-label="실행 취소" title="실행 취소" onClick={onUndo}><Undo2 className="size-[18px]" /></Button>
      <Button size="icon" variant="ghost" aria-label="다시 실행" title="다시 실행" onClick={onRedo}><Redo2 className="size-[18px]" /></Button>
      <span className="tool-rail-divider" aria-hidden="true" />
      <Button size="icon" variant="ghost" aria-label="문장 모두 지우기" title="문장 모두 지우기" onClick={onClear}><Trash2 className="size-[18px]" /></Button>

      <div className="tool-rail-settings" ref={settings}>
        <Button size="icon" variant={settingsOpen ? 'default' : 'ghost'} aria-expanded={settingsOpen} aria-controls="pen-settings" aria-label="쓰기 설정" title="쓰기 설정" onClick={() => setSettingsOpen(!settingsOpen)}><SlidersHorizontal className="size-[18px]" /></Button>
        {settingsOpen && (
          <div className="pen-settings" id="pen-settings" role="group" aria-label="쓰기 설정">
            <div className="pen-setting">
              <div><span>글자 칸 크기</span><output>{cellSize}px</output></div>
              <Hint className="block" side="bottom" label={cellSizeLocked && '작성한 획의 칸 위치를 보존하기 위해 크기가 고정됐어요.'}>
                <Slider aria-label="글자 칸 크기" min={112} max={184} step={4} disabled={cellSizeLocked} value={[cellSize]} onValueChange={([value]) => onCellSize(value)} />
              </Hint>
            </div>
            <div className="pen-setting">
              <div><span>획 굵기</span><output>{strokeWidth.toFixed(1)}</output></div>
              <Slider aria-label="획 굵기" min={1} max={5} step={0.1} value={[strokeWidth]} onValueChange={([value]) => onStrokeWidth(value)} />
            </div>
            <div className="pen-setting">
              <div><span>손떨림 보정</span><output>{endpointStabilization.toFixed(2)}</output></div>
              <Slider aria-label="손떨림 보정" min={0} max={1} step={0.01} value={[endpointStabilization]} onValueChange={([value]) => onEndpointStabilization(value)} />
            </div>
            <Button className="w-full" size="sm" variant={showHints ? 'default' : 'secondary'} aria-pressed={showHints} onClick={onToggleHints}><SquareDashed className="size-3.5" /> 자리 안내</Button>
            <p>아직 쓸 자모의 자리를 점선으로 보여줘요.</p>
          </div>
        )}
      </div>
    </div>
  )
})
