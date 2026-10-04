import { Eraser, PenLine, Redo2, RotateCcw, SquareDashed, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

export type CanvasTool = 'pen' | 'eraser'

export function CanvasToolbar({ tool, strokeWidth, endpointStabilization, showHints, onTool, onStrokeWidth, onEndpointStabilization, onToggleHints, onUndo, onRedo, onClear }: {
  tool: CanvasTool
  strokeWidth: number
  endpointStabilization: number
  showHints: boolean
  onTool(tool: CanvasTool): void
  onStrokeWidth(value: number): void
  onEndpointStabilization(value: number): void
  onToggleHints(): void
  onUndo(): void
  onRedo(): void
  onClear(): void
}) {
  return (
    <div className="canvas-toolbar" aria-label="그리기 도구와 획 굵기">
      <div className="canvas-tool-buttons" role="group" aria-label="그리기 도구">
        <Button size="sm" variant={tool === 'pen' ? 'default' : 'ghost'} aria-pressed={tool === 'pen'} onClick={() => onTool('pen')}><PenLine className="size-3.5" /> 펜</Button>
        <Button size="sm" variant={tool === 'eraser' ? 'default' : 'ghost'} aria-pressed={tool === 'eraser'} onClick={() => onTool('eraser')}><Eraser className="size-3.5" /> 지우개</Button>
      </div>
      <span className="canvas-toolbar-divider" aria-hidden="true" />
      <div className="canvas-stroke-control"><span>획 굵기</span><div className="canvas-stroke-slider"><Slider aria-label="획 굵기" min={1} max={5} step={0.1} value={[strokeWidth]} onValueChange={([value]) => onStrokeWidth(value)} /></div><span className="canvas-stroke-value">{strokeWidth.toFixed(1)}</span></div>
      <div className="canvas-stroke-control"><span>손떨림 보정</span><div className="canvas-stroke-slider"><Slider aria-label="손떨림 보정" min={0} max={1} step={0.01} value={[endpointStabilization]} onValueChange={([value]) => onEndpointStabilization(value)} /></div><span className="canvas-stroke-value">{endpointStabilization.toFixed(2)}</span></div>
      <span className="canvas-toolbar-divider" aria-hidden="true" />
      <Button size="sm" variant={showHints ? 'default' : 'ghost'} aria-pressed={showHints} title="아직 쓸 자모의 자리를 점선으로 보여줘요" onClick={onToggleHints}><SquareDashed className="size-3.5" /> 자리 안내</Button>
      <span className="canvas-toolbar-divider" aria-hidden="true" />
      <div className="canvas-history-buttons">
        <Button aria-label="실행 취소" size="icon" variant="ghost" onClick={onUndo}><Undo2 className="size-4" /></Button>
        <Button aria-label="다시 실행" size="icon" variant="ghost" onClick={onRedo}><Redo2 className="size-4" /></Button>
        <Button aria-label="문장 모두 지우기" size="icon" variant="ghost" onClick={onClear}><RotateCcw className="size-4" /></Button>
      </div>
    </div>
  )
}
