import { Link, Outlet } from '@tanstack/react-router'
import { CircleHelp } from 'lucide-react'
import { useProject } from '@/project/use-project'

export function AppShell() {
  const hydrated = useProject((state) => state.hydrated)

  return (
    <div className="min-h-svh bg-[#F8F9FB] text-[#17181A]">
      <header className="flex h-[52px] items-center justify-between border-b border-[#EEF0F2] bg-white px-5">
        <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em]">
          <span className="grid size-6 place-items-center rounded-md bg-[#2457F5] text-[11px] font-bold text-white">O</span>
          OwnChar
        </Link>
        <nav className="flex items-center gap-1 text-sm text-[#62656B]">
          <Link to="/license" className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 hover:bg-[#F2F4F7]">
            <CircleHelp className="size-4" /> 도움말
          </Link>
          <a href="https://github.com/moka-ayumu/OwnChar" target="_blank" rel="noreferrer" className="rounded-md px-2.5 py-1.5 hover:bg-[#F2F4F7]">
            GitHub
          </a>
        </nav>
      </header>

      <div className="phone-message">
        <div>
          <span className="mb-4 inline-grid size-10 place-items-center rounded-lg bg-[#2457F5] font-semibold text-white">O</span>
          <h1>더 넓은 화면이 필요해요</h1>
          <p>OwnChar는 정밀한 손글씨 입력을 위해 태블릿 또는 데스크톱에서 사용할 수 있습니다.</p>
        </div>
      </div>

      <main className="app-content">
        {!hydrated ? <div className="grid min-h-[calc(100svh-52px)] place-items-center text-sm text-[#62656B]">작업을 불러오는 중…</div> : <Outlet />}
      </main>
    </div>
  )
}
