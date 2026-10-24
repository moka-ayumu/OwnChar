import { useEffect, useMemo, useRef } from 'react'
import opentype from 'opentype.js'
import { RotateCcw } from 'lucide-react'
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/hint'
import { Segmented } from '@/components/segmented'
import { Slider } from '@/components/ui/slider'
import { renderCalibratedGlyph } from '@/font/glyphs/calibration'
import { composeStandaloneJamoPath } from '@/font/glyphs/standalone-jamo'
import { decomposeHangul } from '@/font/hangul'
import { DEFAULT_COMPOSITION_SETTINGS, type CompositionSettings } from '@/font/settings'
import { composedHangulPath, jamoReference, standaloneJamoReference } from '@/generation/font-builder'
import { useCompositionContext } from '@/generation/use-composition-context'
import { projectActions } from '@/project/store'
import { NumberField } from './number-field'

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
  const style = getComputedStyle(canvas)
  const rule = style.getPropertyValue('--color-rule').trim() || '#D9DAD5'
  const ink = style.getPropertyValue('--color-ink').trim() || '#101114'
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, size, size)
  context.strokeStyle = rule
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
  context.fillStyle = ink
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
    <Hint className="block" side="bottom" label={caption}>
      <figure className="composition-example-card">
        <canvas ref={canvasRef} className="w-full" style={{ aspectRatio: '1' }} aria-label={ariaLabel} />
        <figcaption className="flex items-baseline justify-between gap-2 border-t border-rule px-3 py-2">
          <strong className="text-lg font-bold">{char}</strong>
          {note && <span className="tnum text-xs font-semibold text-ink-2">{note}</span>}
        </figcaption>
      </figure>
    </Hint>
  )
}

const percent = (value: number) => `${Math.round(value * 100)}%`

function RangeField({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange(value: number): void }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold"><span className="text-ink-2">{label}</span><output className="tnum">{percent(value)}</output></div>
      <div className="mt-2"><Slider aria-label={label} min={min} max={1} step={0.01} value={[value]} onValueChange={([next]) => onChange(next)} /></div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="control-group">
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
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


const WIDTH_MODES = [['proportional', '가변 폭'], ['fixed', '고정 폭']] as const

function CompositionControls({ settings }: { settings: CompositionSettings }) {
  const set = projectActions.updateCompositionSettings
  return (
    <div>
      <Group title="크기">
        {scaleFields.map((field) => (
          <Hint key={field.key} className="block" side="left" label={field.help}>
            <NumberField label={field.label} value={settings[field.key]} step={0.05} min={0.5} onCommit={(value) => set({ [field.key]: Math.min(1.2, value) })} />
          </Hint>
        ))}
      </Group>
      <Group title="보정">
        <Hint className="block" side="left" label="0은 원본 획, 1은 획의 떨림과 시작·끝의 갈고리를 최대로 보정합니다. 모서리는 유지됩니다.">
          <RangeField label="손떨림 보정 강도" value={settings.endpointStabilization} onChange={(value) => set({ endpointStabilization: value })} />
        </Hint>
        <Hint className="block" side="left" label="쓰지 않은 쌍자음(ㄲㄸㅃㅆㅉ)은 단자음 둘로 만듭니다. 0은 두 자음을 붙이고, 1은 겹받침과 같은 간격을 둡니다.">
          <RangeField label="합성 쌍자음 간격" value={settings.doubleConsonantGap} onChange={(value) => set({ doubleConsonantGap: value })} />
        </Hint>
      </Group>
      <Group title="정렬">
        <Hint className="block" side="left" label="0은 원본 크기, 1은 완성된 필기의 대표 크기에 가장 가깝게 맞춥니다.">
          <div className="space-y-5">
            {normalizationFields.map(([key, label]) => <RangeField key={key} label={label} value={settings[key]} onChange={(value) => set({ [key]: value })} />)}
          </div>
        </Hint>
        <Hint className="block" side="left" label="자음·모음 한 글자를 현재 프로젝트의 ‘가’ 잉크 폭과 높이 안에 같은 비율로 맞춥니다.">
          <RangeField label="단독 자모 크기" min={0.1} value={settings.standaloneJamoMaxHeight} onChange={(value) => set({ standaloneJamoMaxHeight: value })} />
        </Hint>
        <Hint className="block" side="left" label="문자 역할별 기준 높이에 맞춥니다. 기호는 별도 규칙을 사용합니다.">
          <RangeField label="수직 정렬" value={settings.verticalAlignment} onChange={(value) => set({ verticalAlignment: value })} />
        </Hint>
        <div>
          <span className="input-label">글자 가로폭</span>
          <Segmented className="mt-1.5 w-full" options={WIDTH_MODES} value={settings.widthMode} onChange={(widthMode) => set({ widthMode })} label="글자 가로폭" />
        </div>
      </Group>
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
      return { char, path: renderCalibratedGlyph((penScale) => shape ? composeStandaloneJamoPath(shape, settings, standaloneJamoReference(char, shapes, composition, reference), penScale) : new opentype.Path(), visualScale, reference.centerY, 450, fixedWidth) }
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
        <div className="composition-example-grid">
          {standalone.map(({ char, path }) => <ExampleCard key={char} char={char} path={path} ariaLabel={`${char} 단독 자모 미리보기`} caption={`단독 자모 · 조합 글자 기준 ${Math.round(settings.standaloneJamoMaxHeight * 100)}%`} />)}
          {syllables.map(({ char, path, label, note }) => <ExampleCard key={char} char={char} path={path} ariaLabel={`${char} 조합 미리보기`} caption={label} note={note} />)}
        </div>
      </main>
      <aside className="composition-control-panel" aria-label="한글 조합 설정">
        <CompositionControls settings={settings} />
      </aside>
    </div>
  )
}
