import { useEffect, useRef, useState } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/hint'
import { Slider } from '@/components/ui/slider'
import { DEFAULT_COMPOSITION_SETTINGS, type CompositionSettings } from '@/font/settings'
import { projectActions } from '@/project/store'

const DIALS = [
  { key: 'widthNormalization', label: '글자 폭' },
  { key: 'initialNormalization', label: '초성 크기' },
  { key: 'medialNormalization', label: '중성 크기' },
  { key: 'finalNormalization', label: '종성 크기' },
] as const

type DialValues = Record<typeof DIALS[number]['key'], number>

const defaults = Object.fromEntries(DIALS.map((dial) => [dial.key, DEFAULT_COMPOSITION_SETTINGS[dial.key]])) as DialValues

const DETAILS_KEY ='ownchar.preview.dial-details'
const RESET_MS = 240
const percent = (value: number) => `${Math.round(value * 100)}%`

function readDetailsOpen() {
  try {
    return window.localStorage.getItem(DETAILS_KEY) === 'open'
  } catch {
    return false
  }
}

function writeDetailsOpen(open: boolean) {
  try {
    window.localStorage.setItem(DETAILS_KEY, open ? 'open' : 'closed')
  } catch {
    // Which part of the panel is open is a per-device convenience; without storage it starts closed.
  }
}

/** The size dials under the typed text: one slider for all of them, and one for each. */
export function DialPanel({ settings }: { settings: CompositionSettings }) {
  const [open, setOpen] = useState(readDetailsOpen)
  const frame = useRef(0)
  const values = DIALS.map((dial) => settings[dial.key])
  const all = values.reduce((sum, value) => sum + value, 0) / values.length
  const mixed = values.some((value) => Math.abs(value - values[0]) > 0.005)
  const untouched = DIALS.every((dial) => settings[dial.key] === defaults[dial.key])

  // A reset that is left half way would keep the dials at a value nobody chose.
  useEffect(() => () => {
    if (!frame.current) return
    cancelAnimationFrame(frame.current)
    projectActions.updateCompositionSettings(defaults)
  }, [])

  const stop = () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
  }
  const set = (patch: Partial<DialValues>) => {
    stop()
    projectActions.updateCompositionSettings(patch)
  }
  const setAll = (value: number) => set(Object.fromEntries(DIALS.map((dial) => [dial.key, value])))
  /** Brings every dial back to its default through the values between, so the text is seen to move back. */
  const reset = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { set(defaults); return }
    const from = values
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / RESET_MS)
      const left = progress === 1 ? 0 : 2 ** (-10 * progress)
      projectActions.updateCompositionSettings(Object.fromEntries(DIALS.map((dial, index) => [dial.key, defaults[dial.key] + (from[index] - defaults[dial.key]) * left])))
      frame.current = progress < 1 ? requestAnimationFrame(step) : 0
    }
    stop()
    frame.current = requestAnimationFrame(step)
  }
  const toggle = () => {
    writeDetailsOpen(!open)
    setOpen(!open)
  }

  return (
    <section className="dial-panel settle" aria-labelledby="dial-title">
      <Hint className="block" side="top" label={<>100%는 자모 크기와 글자 폭을 평균에 맞춥니다. 더 올리면 평균에서 먼 글자까지 맞춥니다.{mixed && ' 세부 값이 서로 다릅니다. 이 슬라이더를 움직이면 모두 같은 값이 됩니다.'}</>}>
      <div className="flex items-center gap-4">
        <h2 id="dial-title" className="shrink-0 text-sm font-semibold">글자 고르게</h2>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0 text-xs font-semibold text-ink-2">쓴 그대로</span>
          <Slider aria-label="글자 고르게" min={0} max={2} step={0.01} value={[all]} onValueChange={([value]) => setAll(value)} />
          <span className="shrink-0 text-xs font-semibold text-ink-2">고르게</span>
        </div>
        <output className="tnum w-11 text-right text-sm font-semibold">{percent(all)}</output>
      </div>
      </Hint>
      <div className="flex items-center justify-end gap-4">
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls="dial-details" onClick={toggle}>
            <ChevronDown className={`size-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} /> 세부 조정
          </Button>
          <Button size="sm" variant="ghost" disabled={untouched} onClick={reset}><RotateCcw className="size-3.5" /> 기본값으로</Button>
        </div>
      </div>
      {open && (
        <div id="dial-details" className="dial-details">
          {DIALS.map((dial) => (
            <div key={dial.key}>
              <div className="flex items-center justify-between text-xs font-semibold">
                <label htmlFor={`dial-${dial.key}`} className="text-ink-2">{dial.label}</label>
                <span className="tnum">{percent(settings[dial.key])}</span>
              </div>
              <Slider id={`dial-${dial.key}`} aria-label={dial.label} min={0} max={2} step={0.01} value={[settings[dial.key]]} onValueChange={([value]) => set({ [dial.key]: value })} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
