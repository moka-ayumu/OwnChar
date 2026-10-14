import { useEffect } from 'react'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { saveStatusStore } from '@/project/persistence'
import { projectStore } from '@/project/store'
import { useProject } from '@/project/use-project'
import { AppNav } from './app-nav'
import { SaveFailedNotice } from './save-failed-notice'

/** Pages whose rail carries the logo, so they run without the header. */
const FLOW_PATHS = ['/write', '/generate', '/preview']

export function AppShell() {
  const hydrated = useProject((state) => state.hydrated)
  const inFlow = useRouterState({ select: (state) => FLOW_PATHS.includes(state.location.pathname) })
  // The write page's menu carries the logo's job at phone width, so the header yields its row to the canvas.
  const onWrite = useRouterState({ select: (state) => state.location.pathname === '/write' })

  // Closing the tab while a write is pending or has failed would lose work, so the browser asks first.
  // Its text is the browser's own; a page cannot set it.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (saveStatusStore.state === 'saved' || projectStore.state.status === 'empty') return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  return (
    <div className="app-shell min-h-svh bg-ground text-ink" data-flow={inFlow ? 'true' : undefined} data-write={onWrite ? 'true' : undefined}>
      <header className="app-header">
        <Link to="/" className="app-logo">
          <span className="app-logo-mark" aria-hidden="true"><i /></span>
          OwnChar
        </Link>
        <AppNav />
      </header>

      <SaveFailedNotice />

      <main className="app-content">
        {!hydrated ? <div className="grid min-h-[calc(100svh-var(--header))] place-items-center text-sm font-semibold text-ink-2">작업을 불러오는 중…</div> : <Outlet />}
      </main>
    </div>
  )
}
