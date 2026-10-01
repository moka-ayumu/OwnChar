import { forwardRef, memo, useImperativeHandle, useRef, useState, type PointerEvent } from 'react'
import { strokeSvgPath, type RawStroke } from '@/font/stroke-outline'

export interface WritingSurfaceHandle {
  undo(): void
  redo(): void
  clear(): void
}

interface Props {
  initialElements: readonly RawStroke[]
  cellSize: number
  width: number
  height: number
  strokeWidth: number
  endpointStabilization: number
  tool: 'freedraw' | 'eraser'
  onChange(elements: readonly RawStroke[]): void
}

const StrokePathView = memo(function StrokePathView({ stroke, cellSize, endpointStabilization }: { stroke: RawStroke; cellSize: number; endpointStabilization: number }) {
  return <path d={strokeSvgPath(stroke, cellSize, endpointStabilization)} transform={`translate(${stroke.x} ${stroke.y})`} fill="#17181A" fillRule="nonzero" />
})

export const WritingSurface = forwardRef<WritingSurfaceHandle, Props>(function WritingSurface({ initialElements, cellSize, width, height, strokeWidth, endpointStabilization, tool, onChange }, ref) {
  const [elements, setElements] = useState<RawStroke[]>(() => initialElements.filter((element) => element.type === 'freedraw').map((element) => ({ ...element })))
  const current = useRef(elements)
  const past = useRef<RawStroke[][]>([])
  const future = useRef<RawStroke[][]>([])
  const pointer = useRef<{ id: number; strokeId?: string; erasing: boolean } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const publish = (next: RawStroke[]) => {
    current.current = next
    setElements(next)
    onChangeRef.current(next)
  }
  const checkpoint = () => {
    past.current.push(current.current)
    if (past.current.length > 50) past.current.shift()
    future.current = []
  }
  useImperativeHandle(ref, () => ({
    undo() {
      const previous = past.current.pop()
      if (!previous) return
      future.current.push(current.current)
      publish(previous)
    },
    redo() {
      const next = future.current.pop()
      if (!next) return
      past.current.push(current.current)
      publish(next)
    },
    clear() {
      if (!current.current.length) return
      checkpoint()
      publish([])
    },
  }))

  const position = (event: Pick<globalThis.PointerEvent, 'clientX' | 'clientY'>, rect: DOMRect) => {
    return [event.clientX - rect.left, event.clientY - rect.top] as [number, number]
  }
  const samples = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const native = event.nativeEvent
    const coalesced = native.getCoalescedEvents?.() ?? []
    const events = coalesced.length ? coalesced : [native]
    return events.map((sample) => ({
      point: position(sample, rect),
      pressure: sample.pointerType === 'pen' ? sample.pressure : 1,
    }))
  }
  const eraseAt = (x: number, y: number) => {
    let changed = false
    const next = current.current.map((stroke) => {
      if (stroke.isDeleted) return stroke
      const radius = Math.max(9, stroke.strokeWidth * 5)
      const hit = stroke.points.some(([px, py], index) => {
        const ax = stroke.x + px
        const ay = stroke.y + py
        if (Math.hypot(ax - x, ay - y) <= radius) return true
        if (index === 0) return false
        const [beforeX, beforeY] = stroke.points[index - 1]
        const bx = stroke.x + beforeX
        const by = stroke.y + beforeY
        const lengthSquared = (ax - bx) ** 2 + (ay - by) ** 2
        const t = lengthSquared ? Math.max(0, Math.min(1, ((x - bx) * (ax - bx) + (y - by) * (ay - by)) / lengthSquared)) : 0
        return Math.hypot(bx + t * (ax - bx) - x, by + t * (ay - by) - y) <= radius
      })
      if (!hit) return stroke
      changed = true
      return { ...stroke, isDeleted: true, version: stroke.version + 1 }
    })
    if (changed) publish(next)
  }

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || pointer.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    const [x, y] = position(event.nativeEvent, rect)
    checkpoint()
    if (tool === 'eraser') {
      pointer.current = { id: event.pointerId, erasing: true }
      eraseAt(x, y)
      return
    }
    const id = crypto.randomUUID()
    const stroke: RawStroke = {
      id, type: 'freedraw', x, y, width: 0, height: 0,
      points: [[0, 0]], pressures: [event.pointerType === 'pen' ? event.pressure : 1],
      // Calibrate the slider so 3 produces the previous thickness of 1.5.
      strokeWidth: strokeWidth / 6, version: 1, simulatePressure: false, lastCommittedPoint: null,
    }
    pointer.current = { id: event.pointerId, strokeId: id, erasing: false }
    publish([...current.current, stroke])
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (pointer.current?.id !== event.pointerId || !(event.buttons & 1)) return
    const incoming = samples(event)
    const [x, y] = incoming.at(-1)!.point
    if (pointer.current.erasing) {
      eraseAt(x, y)
      return
    }
    const id = pointer.current.strokeId
    const next = current.current.map((stroke) => {
      if (stroke.id !== id) return stroke
      const points: [number, number][] = [...stroke.points]
      const pressures = [...stroke.pressures]
      for (const sample of incoming) {
        const px = sample.point[0] - stroke.x
        const py = sample.point[1] - stroke.y
        const last = points.at(-1)!
        if (Math.hypot(px - last[0], py - last[1]) < 0.25) continue
        points.push([px, py])
        pressures.push(sample.pressure)
      }
      if (points.length === stroke.points.length) return stroke
      return {
        ...stroke, points,
        pressures,
        width: Math.max(...points.map(([pointX]) => pointX)) - Math.min(...points.map(([pointX]) => pointX)),
        height: Math.max(...points.map(([, pointY]) => pointY)) - Math.min(...points.map(([, pointY]) => pointY)),
        version: stroke.version + 1,
      }
    })
    if (next.some((stroke, index) => stroke !== current.current[index])) publish(next)
  }
  const onPointerEnd = (event: PointerEvent<SVGSVGElement>) => {
    if (pointer.current?.id !== event.pointerId) return
    const id = pointer.current.strokeId
    const incoming = pointer.current.erasing ? [] : samples(event)
    pointer.current = null
    if (id) publish(current.current.map((stroke) => {
      if (stroke.id !== id) return stroke
      const points: [number, number][] = [...stroke.points]
      const pressures = [...stroke.pressures]
      for (const sample of incoming) {
        const px = sample.point[0] - stroke.x
        const py = sample.point[1] - stroke.y
        const last = points.at(-1)!
        if (Math.hypot(px - last[0], py - last[1]) < 0.25) continue
        points.push([px, py])
        pressures.push(sample.pressure)
      }
      return {
        ...stroke,
        points,
        pressures,
        width: Math.max(...points.map(([pointX]) => pointX)) - Math.min(...points.map(([pointX]) => pointX)),
        height: Math.max(...points.map(([, pointY]) => pointY)) - Math.min(...points.map(([, pointY]) => pointY)),
        lastCommittedPoint: points.at(-1) ?? null,
        version: stroke.version + 1,
      }
    }))
  }

  return <svg className="writing-surface" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="손글씨 입력 영역" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
    {elements.filter((element) => !element.isDeleted).map((stroke) => <StrokePathView key={stroke.id} stroke={stroke} cellSize={cellSize} endpointStabilization={endpointStabilization} />)}
  </svg>
})
