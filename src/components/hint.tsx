import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * A short note shown beside what it wraps while that is hovered or focused.
 * It is drawn over the page, so a scrolling or clipping parent never cuts it.
 * A touch or pen press shows it for a moment. Nothing shows without a label.
 */
export function Hint({ label, side = 'right', className, children }: {
  label: ReactNode
  side?: 'right' | 'bottom'
  className?: string
  children: ReactNode
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
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
  const position = !box ? undefined : side === 'right'
    ? { left: box.right + 8, top: box.top + box.height / 2 }
    : { left: box.left + box.width / 2, top: box.bottom + 8 }

  return (
    <span
      ref={anchor} className={cn('hint-anchor', className)}
      onPointerEnter={show} onFocus={show} onBlur={hide}
      // A finger or pen leaves as soon as it lifts; keep the note up long enough to read.
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') hide(); else timer.current = window.setTimeout(hide, 1800) }}
    >
      {children}
      {label && position && createPortal(<span role="tooltip" className="hint" data-side={side} style={position}>{label}</span>, document.body)}
    </span>
  )
}
