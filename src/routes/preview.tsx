import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Download, PenLine, RefreshCw, Settings2 } from 'lucide-react'
import { BASE_CHARACTER_PROMPTS } from '@/collection/prompts'
import { RailBrand } from '@/components/rail-brand'
import { Button, buttonVariants } from '@/components/ui/button'
import { isHangulSyllable } from '@/font/hangul'
import { Slider } from '@/components/ui/slider'
import { flow, prefersReducedMotion } from '@/lib/flow'
import { useFontFace } from '@/lib/use-font-face'
import { useProject } from '@/project/use-project'
import { cn, downloadArrayBuffer, safeFilename } from '@/lib/utils'
import { projectActions } from '@/project/store'

export const Route = createFileRoute('/preview')({ component: PreviewPage })

const samples = [
  '오늘 하루도 좋은 하루 보내세요.',
  '가나다라마바사아자차카타파하',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
]

/** Milliseconds between typed characters when arriving from generation. */
const TYPE_INTERVAL = 85

function PreviewPage() {
  const navigate = useNavigate()
  const buffer = useProject((state) => state.generatedFont)
  const revision = useProject((state) => state.fontRevision)
  const metadata = useProject((state) => state.metadata)
  const dirty = useProject((state) => state.fontDirty)
  const drawings = useProject((state) => state.drawings)
  // A sample whose letters were never written has no glyphs to show, and says so.
  const writable = (text: string) => [...text].some((char) => isHangulSyllable(char.codePointAt(0)!) || BASE_CHARACTER_PROMPTS.some((prompt) => prompt.char === char && drawings[prompt.id]))
  const fontReady = useFontFace(buffer, revision)
  const [sample, setSample] = useState(samples[0])
  const [fontSize, setFontSize] = useState(80)
  // Arriving from generation, the sentence types itself; the first character is the glyph generation ended on.
  const [typed, setTyped] = useState(() => flow.takeTypedArrival() && !prefersReducedMotion() ? 1 : null)
  const typing = typed !== null

  useEffect(() => {
    if (!buffer) void navigate({ to: '/write' })
  }, [buffer, navigate])

  useEffect(() => {
    if (typed === null) return
    const timer = window.setTimeout(() => setTyped(typed >= samples[0].length ? null : typed + 1), typed === 1 ? 760 : typed >= samples[0].length ? 500 : TYPE_INTERVAL)
    return () => window.clearTimeout(timer)
  }, [typed])

  if (!buffer) return null
  const fontFamily = fontReady ? 'OwnCharPreview' : 'inherit'
  const textStyle = { fontFamily, fontSize, lineHeight: 1.25 }

  return (
    <div className="flow">
      <aside className="rail">
        <RailBrand />
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">손글씨가 폰트가 되었어요.</h1>
        <p className="rail-note mt-2">문장을 바꿔 보거나 글자 간격을 더 세밀하게 다듬어 보세요.</p>

        <div className="mt-6 space-y-4">
          <div><label className="input-label" htmlFor="familyName">폰트 이름</label><input id="familyName" className="text-input mt-1.5" value={metadata.familyName} onChange={(event) => projectActions.updateFontMetadata({ familyName: event.target.value })} /></div>
          <div><label className="input-label" htmlFor="designer">제작자</label><input id="designer" className="text-input mt-1.5" value={metadata.designer} placeholder="이름을 입력하세요" onChange={(event) => projectActions.updateFontMetadata({ designer: event.target.value })} /></div>
          <div><label className="input-label" htmlFor="version">버전</label><input id="version" className="text-input mt-1.5" value={metadata.version} onChange={(event) => projectActions.updateFontMetadata({ version: event.target.value })} /></div>
        </div>
        <p className="rail-note mt-4">폰트는 서버로 전송되지 않으며 이 브라우저에서 생성됩니다.</p>

        <div className="mt-auto grid gap-2 pt-6">
          <Button size="lg" onClick={() => downloadArrayBuffer(buffer, `${safeFilename(metadata.familyName)}.otf`)}><Download className="size-4" /> OTF 다운로드</Button>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/write" viewTransition className={cn(buttonVariants({ variant: 'secondary' }), 'px-2')}><PenLine className="size-4" /> 글자 다시 쓰기</Link>
            <Link to="/edit" className={cn(buttonVariants({ variant: 'secondary' }), 'px-2')}><Settings2 className="size-4" /> 고급 편집</Link>
          </div>
        </div>
      </aside>

      <section className="stage">
        <div className="preview-stage">
          {dirty && (
            <div className="mb-6 flex items-center justify-between gap-4 rounded-md bg-ink px-4 py-3 text-sm text-white" role="status">
              <span>필기 또는 폰트 생성 설정이 변경되었습니다. 변경 적용 후 새 OTF를 받을 수 있습니다.</span>
              <Button size="sm" variant="lime" onClick={() => void navigate({ to: '/generate', viewTransition: true })}><RefreshCw className="size-3.5" /> 변경 적용</Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-6">
            <label htmlFor="sample" className="text-sm font-semibold text-ink-2">직접 입력해 보세요</label>
            <div className="flex w-64 items-center gap-3">
              <label htmlFor="preview-size" className="shrink-0 text-xs font-semibold text-ink-2">글자 크기</label>
              <Slider id="preview-size" aria-label="미리보기 글자 크기" min={36} max={160} step={2} value={[fontSize]} onValueChange={([value]) => setFontSize(value)} />
              <span className="tnum w-11 text-right text-xs font-semibold">{fontSize}px</span>
            </div>
          </div>

          <div className="type-stack">
            <textarea
              id="sample"
              value={sample}
              onChange={(event) => setSample(event.target.value)}
              onFocus={() => setTyped(null)}
              className="font-preview min-h-64 w-full resize-y border-0 bg-transparent p-0 outline-none placeholder:text-ink-3"
              style={{ ...textStyle, opacity: typing ? 0 : 1 }}
            />
            {typing && (
              <div className="font-preview type-overlay" aria-hidden="true" style={textStyle}>
                <span className="lead">{samples[0][0]}</span>{samples[0].slice(1, typed)}<i className="type-caret" />
              </div>
            )}
          </div>

          <div className={cn('mt-10', !typing && 'settle')}>
            {samples.slice(1).map((text) => (
              writable(text)
                ? <button key={text} onClick={() => setSample(text)} className="font-preview sample-row" style={{ fontFamily, visibility: typing ? 'hidden' : undefined }}><span>{text}</span></button>
                : <button key={text} onClick={() => setSample(text)} className="sample-row unwritten" style={{ visibility: typing ? 'hidden' : undefined }}><span>{text}</span><small>아직 쓰지 않은 글자예요</small></button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
