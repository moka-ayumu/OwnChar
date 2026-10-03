import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/license')({ component: LicensePage })

function LicensePage() {
  return (
    <article className="mx-auto max-w-3xl px-8 py-12">
      <Link to="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3')}><ArrowLeft className="size-4" /> 돌아가기</Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-[-0.04em]">도움말 및 오픈소스</h1>
      <p className="mt-4 leading-7 text-[#62656B]">OwnChar는 모든 글자 데이터와 폰트 생성을 사용자의 브라우저 안에서 처리합니다. 계정이나 서버 업로드가 필요하지 않습니다.</p>

      <section className="mt-10 border-t border-[#E5E7EB] pt-8">
        <h2 className="text-lg font-semibold">작성 방법</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#62656B]">
          <li>기본 자모와 영문·숫자를 작성하고, 실제 배치가 달라지는 8/2/1 문맥별 자모 variant를 필요에 따라 추가합니다.</li>
          <li>펜 입력은 캔버스 중앙을 넉넉하게 사용하고 획이 겹쳐도 괜찮습니다.</li>
          <li>모든 글자를 작성하면 현대 한글 11,172자가 자동으로 조합됩니다.</li>
          <li>미리보기와 고급 편집에서 간격·크기·위치를 조정한 뒤 OTF를 내려받습니다.</li>
        </ol>
      </section>

      <section className="mt-10 border-t border-[#E5E7EB] pt-8">
        <h2 className="text-lg font-semibold">사용 라이브러리</h2>
        <p className="mt-4 text-sm leading-7 text-[#62656B]">React, Vite, TanStack Router, TanStack Store, Tailwind CSS, shadcn/ui/Radix UI, perfect-freehand, Clipper2, opentype.js, Lucide를 사용합니다. 각 라이브러리에는 해당 프로젝트의 오픈소스 라이선스가 적용됩니다.</p>
      </section>
    </article>
  )
}
