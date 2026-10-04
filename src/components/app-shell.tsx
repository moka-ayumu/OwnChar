import { Link, Outlet } from '@tanstack/react-router'
import { CircleHelp } from 'lucide-react'
import { useProject } from '@/project/use-project'

export function AppShell() {
  const hydrated = useProject((state) => state.hydrated)

  return (
    <div className="min-h-svh bg-ground text-ink">
      <header className="app-header">
        <Link to="/" className="app-logo">
          <span className="app-logo-mark" aria-hidden="true"><i /></span>
          OwnChar
        </Link>
        <nav className="app-nav">
          <Link to="/license"><CircleHelp className="size-4" /> 도움말</Link>
          <a href="https://github.com/moka-ayumu/OwnChar" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <div className="phone-message">
        <div>
          <h1>더 넓은 화면이 필요해요</h1>
          <p>OwnChar는 정밀한 손글씨 입력을 위해 태블릿 또는 데스크톱에서 사용할 수 있습니다.</p>
        </div>
      </div>

      <main className="app-content">
        {!hydrated ? <div className="grid min-h-[calc(100svh-var(--header))] place-items-center text-sm font-semibold text-ink-2">작업을 불러오는 중…</div> : <Outlet />}
      </main>
    </div>
  )
}
