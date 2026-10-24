import { useState } from 'react'

/** A number input that keeps what is typed until it loses focus, so a value can be cleared and retyped. */
export function NumberField({ label, value, step = 1, min, className, onCommit }: {
  label: string
  value: number | undefined
  step?: number
  min?: number
  className?: string
  onCommit(value: number): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className={className}>
      <span className="input-label">{label}</span>
      <input
        type="number" className="text-input tnum mt-1.5" step={step} min={min}
        value={draft ?? (value === undefined ? '' : String(value))} placeholder={value === undefined ? '다름' : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          const next = event.target.valueAsNumber
          if (Number.isFinite(next) && (min === undefined || next >= min)) onCommit(next)
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}
