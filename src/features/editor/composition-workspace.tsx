import { useEffect, useMemo, useRef } from 'react'
import opentype from 'opentype.js'
import { RotateCcw } from 'lucide-react'
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records'
import { Button } from '@/components/ui/button'
import { renderCalibratedGlyph } from '@/font/glyphs/calibration'
import { composeStandaloneJamoPath } from '@/font/glyphs/standalone-jamo'
import { decomposeHangul } from '@/font/hangul'
import { DEFAULT_COMPOSITION_SETTINGS, type CompositionSettings } from '@/font/settings'
import { composedHangulPath, jamoReference } from '@/generation/font-builder'
import { useCompositionContext } from '@/generation/use-composition-context'
import { projectActions } from '@/project/store'

const examples = [
  { char: '가', label: '세로 모음 · 받침 없음' },
  { char: '각', label: '세로 모음 · 단일 받침' },
  { char: '갃', label: '세로 모음 · 겹받침 ㄳ' },
  { char: '까', label: '겹초성 ㄲ' },
  { char: '고', label: '가로 모음 · 받침 없음' },
  { char: '곡', label: '가로 모음 · 받침 있음' },
  { char: '과', label: '혼합 모음 ㅘ' },
  { char: '곽', label: '혼합 모음 · 받침 있음' },
  { char: '괘', label: '복합 모음 ㅙ' },
  { char: '좋', label: '가로 모음 · 자연스러운 겹침' },
  { char: '루', label: '가로 모음 · 가운데 정렬' },
]

const standaloneExamples = ['ㅇ', 'ㅜ']

/** Draws a glyph outline in a 1000-unit cell with its frame and baseline. */
function drawGlyph(canvas: HTMLCanvasElement, path: opentype.Path) {
  const dpr = window.devicePixelRatio || 1
  const size = 240
  canvas.width = size * dpr
  canvas.height = size * dpr
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, size, size)
  context.strokeStyle = '#D9DAD5'
  context.lineWidth = 1
  context.strokeRect(20.5, 20.5, 199, 199)
  context.setLineDash([3, 4])
  context.beginPath()
  context.moveTo(20, 210.5)
  context.lineTo(220, 210.5)
  context.stroke()
  context.setLineDash([])

  context.save()
  context.translate(20, 210)
  context.scale(0.2, -0.2)
  context.fillStyle = '#101114'
  context.beginPath()
  for (const command of path.commands) {
    if (command.type === 'M') context.moveTo(command.x, command.y)
    else if (command.type === 'L') context.lineTo(command.x, command.y)
    else if (command.type === 'C') context.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y)
    else if (command.type === 'Q') context.quadraticCurveTo(command.x1, command.y1, command.x, command.y)
    else if (command.type === 'Z') context.closePath()
  }
  context.fill()
  context.restore()
}

function ExampleCard({ char, ariaLabel, path, caption, note }: { char: string; ariaLabel: string; path: opentype.Path; caption: string; note?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvasRef.current) drawGlyph(canvasRef.current, path)
  }, [path])
  return (
    <figure className="composition-example-card">
      <canvas ref={canvasRef} className="w-full" style={{ aspectRatio: '1' }} aria-label={ariaLabel} />
      <figcaption className="flex items-baseline justify-between gap-3 border-t border-rule px-4 py-3">
        <div><strong className="text-xl font-semibold">{char}</strong>{note && <p className="mt-1 text-xs text-ink">{note}</p>}</div>
        <span className="text-right text-xs leading-4 text-ink-3">{caption}</span>
      </figcaption>
    </figure>
  )
}

function RangeField({ label, value, display, min = 0, onChange }: { label: string; value: number; display: string; min?: number; onChange(value: number): void }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs"><span>{label}</span><span className="tabular-nums">{display}</span></span>
      <input aria-label={label} type="range" min={min} max="1" step="0.01" value={value} className="mt-2 w-full accent-ink" onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {help && <p className="mt-1 text-xs leading-4 text-ink-3">{help}</p>}
      {children}
    </div>
  )
}

const scaleFields = [
  { key: 'singleInitialScale', label: '단일 초성 크기', help: 'ㄱ처럼 초성이 하나일 때 차지하는 비율' },
  { key: 'vowelScale', label: '모음 크기', help: '음절 안에서 모음이 차지하는 비율' },
  { key: 'finalScale', label: '받침 크기', help: '단일·겹받침이 받침 영역에서 차지하는 비율' },
] as const

const normalizationFields = [
  ['hangulNormalization', '한글 음절 정규화'],
  ['jamoNormalization', '자모 정규화'],
  ['latinNormalization', '영문 정규화'],
] as const

function CompositionControls({ settings }: { settings: CompositionSettings }) {
  const set = projectActions.updateCompositionSettings
  return (
    <div>
      <h2 className="text-sm font-semibold">한글 조합 설정</h2>
      <p className="mt-2 text-xs leading-5 text-ink-2">왼쪽 예시는 즉시 갱신됩니다. 실제 OTF에는 상단의 변경 적용을 눌러 재합성할 때 반영됩니다.</p>
      <div className="mt-5 space-y-5">
        {scaleFields.map((field) => (
          <label key={field.key} className="block">
            <span className="flex items-center justify-between gap-3">
              <span className="input-label">{field.label}</span>
              <span className="flex items-center gap-1"><input aria-label={field.label} type="number" className="text-input h-8 w-20 py-1 text-right" min={0.5} max={1.2} step={0.05} value={settings[field.key]} onChange={(event) => set({ [field.key]: Number(event.target.value) })} /><span className="w-4 text-xs text-ink-3">×</span></span>
            </span>
            <span className="mt-1 block text-xs leading-4 text-ink-3">{field.help}</span>
          </label>
        ))}
      </div>
      <Section title="손떨림 보정" help="0은 원본 획, 1은 획의 떨림과 시작·끝의 갈고리를 최대로 보정합니다. 모서리는 유지됩니다.">
        <div className="mt-4"><RangeField label="손떨림 보정 강도" value={settings.endpointStabilization} display={settings.endpointStabilization.toFixed(2)} onChange={(value) => set({ endpointStabilization: value })} /></div>
      </Section>
      <Section title="크기 정규화" help="0은 원본 크기, 1은 완성된 필기의 대표 크기에 가장 가깝게 맞춥니다.">
        <div className="mt-4 space-y-4">
          {normalizationFields.map(([key, label]) => <RangeField key={key} label={label} value={settings[key]} display={settings[key].toFixed(2)} onChange={(value) => set({ [key]: value })} />)}
        </div>
      </Section>
      <Section title="단독 자모 크기" help="자음·모음 한 글자를 현재 프로젝트의 ‘가’ 잉크 폭과 높이 안에 같은 비율로 맞춥니다.">
        <div className="mt-4"><RangeField label="단독 자모 크기 비율" min={0.1} value={settings.standaloneJamoMaxHeight} display={`${Math.round(settings.standaloneJamoMaxHeight * 100)}%`} onChange={(value) => set({ standaloneJamoMaxHeight: value })} /></div>
      </Section>
      <Section title="수직 가운데 정렬" help="문자 역할별 기준 높이에 맞춥니다. 기호는 별도 규칙을 사용합니다.">
        <div className="mt-4"><RangeField label="수직 정렬" value={settings.verticalAlignment} display={settings.verticalAlignment.toFixed(2)} onChange={(value) => set({ verticalAlignment: value })} /></div>
      </Section>
      <Section title="글자 가로폭">
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['proportional', 'fixed'] as const).map((mode) => <button key={mode} type="button" aria-pressed={settings.widthMode === mode} className={`rounded-md border px-3 py-2 text-xs ${settings.widthMode === mode ? 'border-ink bg-ink text-white' : 'border-rule hover:border-ink'}`} onClick={() => set({ widthMode: mode })}>{mode === 'proportional' ? '가변 폭' : '고정 폭'}</button>)}
        </div>
      </Section>
      <Button className="mt-6 w-full" variant="secondary" onClick={() => set(DEFAULT_COMPOSITION_SETTINGS)}><RotateCcw className="size-3.5" /> 조합 기본값 복원</Button>
    </div>
  )
}

/** Composition settings beside example syllables composed live from the current handwriting. */
export function CompositionWorkspace({ drawings, sessions, settings }: {
  drawings: Record<string, DrawingRecord>
  sessions: Record<string, WritingSessionRecord>
  settings: CompositionSettings
}) {
  const { shapes, composition, visualScale } = useCompositionContext(drawings, sessions, settings)
  const fixedWidth = settings.widthMode === 'fixed'
  const standalone = useMemo(() => {
    const reference = jamoReference(shapes, composition, visualScale)
    return standaloneExamples.map((char) => {
      const shape = shapes.get(char)
      return { char, path: renderCalibratedGlyph((penScale) => shape ? composeStandaloneJamoPath(shape, settings, reference, penScale) : new opentype.Path(), visualScale, reference.centerY, 450, fixedWidth) }
    })
  }, [shapes, composition, visualScale, settings, fixedWidth])
  const syllables = useMemo(() => examples.map((example) => {
    const codePoint = example.char.codePointAt(0)!
    const { variants, finalIndex } = decomposeHangul(codePoint)
    return {
      ...example,
      path: composedHangulPath(codePoint, shapes, composition, visualScale),
      note: `초 ${variants.initial + 1}벌 · 중 ${variants.medial + 1}벌${finalIndex ? ` · 종 ${variants.final + 1}벌` : ''}`,
    }
  }), [shapes, composition, visualScale])

  return (
    <div className="composition-workspace">
      <main className="composition-preview-area">
        <div className="flex items-end justify-between gap-6">
          <div>
            
            <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">대표 음절로 조합 균형을 확인하세요.</h1>
            <p className="mt-2 text-sm text-ink-2">전체 폰트를 재생성하지 않고 현재 자모와 설정만 Canvas에 조합합니다.</p>
          </div>
          <p className="shrink-0 text-xs text-ink-3">기본형과 입력된 문맥형을 즉시 반영</p>
        </div>
        <div className="composition-example-grid">
          {standalone.map(({ char, path }) => <ExampleCard key={char} char={char} path={path} ariaLabel={`${char} 단독 자모 미리보기`} caption={`단독 자모 · 가 기준 ${Math.round(settings.standaloneJamoMaxHeight * 100)}%`} />)}
          {syllables.map(({ char, path, label, note }) => <ExampleCard key={char} char={char} path={path} ariaLabel={`${char} 조합 미리보기`} caption={label} note={note} />)}
        </div>
      </main>
      <aside className="composition-control-panel">
        <CompositionControls settings={settings} />
      </aside>
    </div>
  )
}
