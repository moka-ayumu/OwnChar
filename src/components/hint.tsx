import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * A short note shown beside what it wraps while that is hovered or focused.
 * Wrap a whole control group and the note stays up while any part of it is used,
 * including a slider drag that leaves the group.
 * It is drawn over the page, so a scrolling or clipping parent never cuts it.
 * A touch or pen press shows it for a moment. Nothing shows without a label.
 */
export function Hint({ label, side = 'right', className, children }: {
  label: ReactNode
  side?: 'right' | 'bottom' | 'left' | 'top'
  className?: string
  children: ReactNode
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const pressed = useRef(false)
  const [box, setBox] = useState<DOMRect | null>(null)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const show = () => {
    window.clearTimeout(timer.current)
    setBox(anchor.current?.getBoundingClientRect() ?? null)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setBox(null)
  }

  // A press that starts inside keeps the note up until it lifts, wherever the pointer has gone.
  const press = () => {
    pressed.current = true
    const release = (event: PointerEvent) => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      pressed.current = false
      if (event.pointerType === 'mouse' && !anchor.current?.matches(':hover')) hide()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
  }

  const position = !box ? undefined
    : side === 'right' ? { left: box.right + 8, top: box.top + box.height / 2 }
      : side === 'left' ? { left: box.left - 8, top: box.top }
        : side === 'top' ? { left: box.left + box.width / 2, top: box.top - 8 }
        : { left: box.left + box.width / 2, top: box.bottom + 8 }

  return (
    <span
      ref={anchor} className={cn('hint-anchor', className)}
      onPointerEnter={show} onFocus={show} onBlur={hide} onPointerDown={press}
      // A finger or pen leaves as soon as it lifts; keep the note up long enough to read.
      onPointerLeave={(event) => {
        if (pressed.current) return
        if (event.pointerType === 'mouse') hide()
        else timer.current = window.setTimeout(hide, 1800)
      }}
    >
      {children}
      {label && position && createPortal(<span role="tooltip" className="hint" data-side={side} style={position}>{label}</span>, document.body)}
    </span>
  )
}
