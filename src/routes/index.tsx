import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, PenLine, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProject } from '@/project/use-project'
import { completedPromptCount, PROMPT_COUNT } from '@/collection/prompts'
import { clearPersistedProject } from '@/project/persistence'
import { projectActions } from '@/project/store'
import { SampleProjectButton } from '@/dev/sample-project-button'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  const navigate = useNavigate()
  const state = useProject((project) => project)
  const completed = completedPromptCount(state.drawings)
  const canResume = state.status !== 'empty' && (completed > 0 || state.generatedFont)

  const start = async () => {
    if (canResume && !window.confirm('현재 작업을 지우고 새로 시작할까요?')) return
    await clearPersistedProject()
    projectActions.startProject()
    void navigate({ to: '/write' })
  }

  return (
    <section className="mx-auto flex min-h-[calc(100svh-52px)] max-w-6xl items-center px-8 py-16">
      {import.meta.env.DEV && <SampleProjectButton />}
      <div className="grid w-full gap-14 md:grid-cols-[1.25fr_.75fr] md:items-center">
        <div>
          <p className="mb-5 text-sm font-medium text-[#2457F5]">손글씨로 만드는 조합형 한글 폰트</p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.15] tracking-[-0.045em] md:text-[44px]">
            예시 문장을 자연스럽게 쓰고,<br />나만의 폰트를 완성하세요.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#62656B]">
            문장을 쓰면 각 음절의 획을 초성·중성·종성으로 나누어 수집합니다. 영문과 숫자까지 작성하면 현대 한글 11,172자를 브라우저에서 조합하며, 원본 획은 이 기기에 함께 저장됩니다.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" onClick={start}>
              <PenLine className="size-4" /> 새 폰트 시작하기
            </Button>
            {canResume && (
              <Button size="lg" variant="secondary" onClick={() => void navigate({ to: state.status === 'ready' ? '/preview' : '/write' })}>
                이어서 만들기 <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="border-l border-[#E5E7EB] pl-8 md:pl-12">
          <div className="space-y-7">
            {[
              ['01', '문장 쓰기', '익숙한 문장을 평소의 속도와 모양으로 써주세요.'],
              ['02', '자모 자동 수집', '글자 칸과 획 순서를 바탕으로 문맥별 자모를 나눠 담습니다.'],
              ['03', '조합하고 다듬기', '완성형 한글을 생성한 뒤 간격과 형태를 세밀하게 조정합니다.'],
            ].map(([number, title, detail]) => (
              <div key={number} className="grid grid-cols-[32px_1fr] gap-3">
                <span className="pt-0.5 text-xs font-semibold text-[#92969D]">{number}</span>
                <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-[#62656B]">{detail}</p></div>
              </div>
            ))}
          </div>
          {canResume && (
            <div className="mt-9 border-t border-[#EEF0F2] pt-6">
              <div className="flex items-baseline justify-between"><span className="text-sm font-medium">현재 작업</span><span className="text-xs text-[#92969D]">{completed} / {PROMPT_COUNT}</span></div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#E5E7EB]"><div className="h-full bg-[#2457F5]" style={{ width: `${completed / PROMPT_COUNT * 100}%` }} /></div>
              <button className="mt-4 inline-flex items-center gap-1 text-xs text-[#92969D] hover:text-[#17181A]" onClick={start}><RotateCcw className="size-3" /> 처음부터 다시 만들기</button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
