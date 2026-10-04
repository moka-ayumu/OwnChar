import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useProject } from '@/project/use-project'
import { AppNav } from './app-nav'

/** Pages whose rail carries the logo, so they run without the header. */
const FLOW_PATHS = ['/write', '/generate', '/preview']

export function AppShell() {
  const hydrated = useProject((state) => state.hydrated)
  const inFlow = useRouterState({ select: (state) => FLOW_PATHS.includes(state.location.pathname) })

  return (
    <div className="app-shell min-h-svh bg-ground text-ink" data-flow={inFlow ? 'true' : undefined}>
      <header className="app-header">
        <Link to="/" className="app-logo">
          <span className="app-logo-mark" aria-hidden="true"><i /></span>
          OwnChar
        </Link>
        <AppNav />
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
