import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Download, PenLine, Settings2, Sparkles } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
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

function PreviewPage() {
  const navigate = useNavigate()
  const buffer = useProject((state) => state.generatedFont)
  const revision = useProject((state) => state.fontRevision)
  const metadata = useProject((state) => state.metadata)
  const dirty = useProject((state) => state.fontDirty)
  const fontReady = useFontFace(buffer, revision)
  const [sample, setSample] = useState(samples[0])
  const [fontSize, setFontSize] = useState(80)

  useEffect(() => {
    if (!buffer) void navigate({ to: '/write' })
  }, [buffer, navigate])

  if (!buffer) return null

  return (
    <section className="mx-auto max-w-6xl px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-[#E5E7EB] pb-8">
        <div>
          <p className="text-sm font-medium text-[#2457F5]">폰트 완성</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">손글씨가 폰트가 되었어요.</h1>
          <p className="mt-2 text-sm text-[#62656B]">문장을 바꿔 보거나 글자 간격을 더 세밀하게 다듬어 보세요.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/write" className={cn(buttonVariants({ variant: 'secondary' }))}><PenLine className="size-4" /> 글자 다시 쓰기</Link>
          <Link to="/edit" className={cn(buttonVariants({ variant: 'secondary' }))}><Settings2 className="size-4" /> 고급 편집</Link>
          <Button onClick={() => downloadArrayBuffer(buffer, `${safeFilename(metadata.familyName)}.otf`)}><Download className="size-4" /> OTF 다운로드</Button>
        </div>
      </div>

      {dirty && (
        <div className="mt-6 flex items-center justify-between rounded-lg border border-[#C7D2FE] bg-[#EEF2FF] px-4 py-3 text-sm text-[#3730A3]">
          <span>필기 또는 폰트 생성 설정이 변경되었습니다. 변경 적용 후 새 OTF를 받을 수 있습니다.</span>
          <Button size="sm" onClick={() => void navigate({ to: '/generate' })}><Sparkles className="size-3.5" /> 변경 적용</Button>
        </div>
      )}

      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_260px]">
        <div>
          <div className="flex items-center justify-between gap-6">
            <label htmlFor="sample" className="text-xs font-medium text-[#92969D]">직접 입력해 보세요</label>
            <div className="flex w-64 items-center gap-3">
              <label htmlFor="preview-size" className="shrink-0 text-xs text-[#62656B]">글자 크기</label>
              <Slider id="preview-size" aria-label="미리보기 글자 크기" min={36} max={160} step={2} value={[fontSize]} onValueChange={([value]) => setFontSize(value)} />
              <span className="w-10 text-right text-xs tabular-nums text-[#62656B]">{fontSize}px</span>
            </div>
          </div>
          <textarea
            id="sample"
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            className="font-preview mt-3 min-h-64 w-full resize-y border-0 bg-transparent p-0 tracking-[-0.04em] outline-none placeholder:text-[#D5D8DD]"
            style={{ fontFamily: fontReady ? 'OwnCharPreview' : 'inherit', fontSize, lineHeight: 1.25 }}
          />
          <div className="mt-12 space-y-8 border-t border-[#EEF0F2] pt-10">
            {samples.slice(1).map((text) => (
              <button key={text} onClick={() => setSample(text)} className="font-preview block w-full text-left text-3xl leading-relaxed text-[#62656B] transition-colors hover:text-[#17181A]" style={{ fontFamily: fontReady ? 'OwnCharPreview' : 'inherit' }}>{text}</button>
            ))}
          </div>
        </div>

        <aside className="space-y-5 border-l border-[#E5E7EB] pl-7">
          <div><label className="input-label" htmlFor="familyName">폰트 이름</label><input id="familyName" className="text-input mt-2" value={metadata.familyName} onChange={(event) => projectActions.updateFontMetadata({ familyName: event.target.value })} /></div>
          <div><label className="input-label" htmlFor="designer">제작자</label><input id="designer" className="text-input mt-2" value={metadata.designer} placeholder="이름을 입력하세요" onChange={(event) => projectActions.updateFontMetadata({ designer: event.target.value })} /></div>
          <div><label className="input-label" htmlFor="version">버전</label><input id="version" className="text-input mt-2" value={metadata.version} onChange={(event) => projectActions.updateFontMetadata({ version: event.target.value })} /></div>
          <p className="pt-2 text-xs leading-5 text-[#92969D]">폰트는 서버로 전송되지 않으며 이 브라우저에서 생성됩니다.</p>
        </aside>
      </div>
    </section>
  )
}
