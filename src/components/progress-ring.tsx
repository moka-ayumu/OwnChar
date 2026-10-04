import { Check } from 'lucide-react'

const RADIUS = 7
const LENGTH = 2 * Math.PI * RADIUS

/** How much of `total` is collected, as a ring that fills clockwise and becomes a check when full. */
export function ProgressRing({ value, total, size = 18 }: { value: number; total: number; size?: number }) {
  if (total > 0 && value >= total) return <Check className="progress-ring" style={{ width: size, height: size }} strokeWidth={3} aria-hidden="true" />
  const filled = total > 0 ? Math.max(0, Math.min(1, value / total)) * LENGTH : 0
  return (
    <svg className="progress-ring" width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle className="progress-ring-track" cx="10" cy="10" r={RADIUS} strokeWidth="3" />
      {filled > 0 && <circle className="progress-ring-arc" cx="10" cy="10" r={RADIUS} strokeWidth="3" strokeDasharray={`${filled} ${LENGTH}`} transform="rotate(-90 10 10)" />}
    </svg>
  )
}
