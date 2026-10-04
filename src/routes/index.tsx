import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, PenLine, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useProject } from '@/project/use-project'
import { completedPromptCount, PROMPT_COUNT } from '@/collection/prompts'
import { FINALS, HANGUL_BASE, INITIALS, MEDIALS } from '@/font/hangul'
import { prefersReducedMotion } from '@/lib/flow'
import { clearPersistedProject } from '@/project/persistence'
import { projectActions } from '@/project/store'
import { SampleProjectButton } from '@/dev/sample-project-button'

export const Route = createFileRoute('/')({ component: HomePage })

/** Initial, medial and final indices the demonstration steps through, changing one jamo at a time. */
const COMBINATIONS = [[18, 0, 4], [18, 0, 0], [0, 0, 0], [0, 8, 0], [0, 8, 1], [2, 8, 1], [2, 13, 1], [2, 13, 4], [18, 13, 4], [18, 0, 4]]

/** Jamo combining into a syllable, set in the interface typeface: an illustration of the principle, not a sample font. */
function CombinationDemo() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % (COMBINATIONS.length - 1)), 1500)
    return () => window.clearInterval(timer)
  }, [])
  const [initial, medial, final] = COMBINATIONS[index]
  const syllable = String.fromCodePoint(HANGUL_BASE + initial * 588 + medial * 28 + final)
  const tiles = [['초성', INITIALS[initial]], ['중성', MEDIALS[medial]], ['종성', FINALS[final]]]
  return (
    <div className="combo" aria-hidden="true">
      <div className="combo-glyph"><span key={syllable}>{syllable}</span></div>
      <div className="combo-tiles">
        {tiles.map(([role, jamo], position) => (
          <div key={role} className={`combo-tile ${jamo ? '' : 'empty'}`}>
            <b><span key={jamo}>{jamo}</span></b>
            <small>{role}</small>
            {position < 2 && <span className="sr-only">+</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

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
    <section className="home">
      {import.meta.env.DEV && <SampleProjectButton />}
      <div className="home-copy">
        <h1 className="max-w-[15em] text-[clamp(34px,4vw,52px)] font-extrabold leading-[1.16] tracking-[-0.035em]">
          예시 문장을 자연스럽게 쓰고, 나만의 폰트를 완성하세요.
        </h1>
        <p className="mt-6 max-w-[34em] text-base leading-7 text-ink-2">
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

        {canResume && (
          <div className="mt-8 max-w-sm">
            <div className="flex items-baseline justify-between text-sm"><span className="font-bold">현재 작업</span><span className="tnum font-semibold text-ink-2">{completed} / {PROMPT_COUNT}</span></div>
            <Progress className="mt-3" value={completed / PROMPT_COUNT * 100} />
            <button className="mt-6 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-ink-2 hover:text-ink" onClick={start}><RotateCcw className="size-3.5" /> 처음부터 다시 만들기</button>
          </div>
        )}

        <ol className="home-steps">
          <li><strong>문장 쓰기</strong><span>익숙한 문장을 평소의 속도와 모양으로 써주세요.</span></li>
          <li><strong>자모 자동 수집</strong><span>글자 칸과 획 순서를 바탕으로 문맥별 자모를 나눠 담습니다.</span></li>
          <li><strong>조합하고 다듬기</strong><span>완성형 한글을 생성한 뒤 간격과 형태를 세밀하게 조정합니다.</span></li>
        </ol>
      </div>
      <div className="home-demo"><CombinationDemo /></div>
    </section>
  )
}
