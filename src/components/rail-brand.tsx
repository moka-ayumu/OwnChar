import { Link } from '@tanstack/react-router'
import { AppNav } from './app-nav'
import { Hint } from './hint'

/**
 * The logo at the top of a flow page's rail, where the header would be.
 * With `onToggle` the mark opens and closes the rail and the wordmark beside
 * it leads home; without it the whole logo leads home and the page links sit
 * at the right.
 */
export function RailBrand({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  if (!onToggle) {
    return (
      <div className="rail-brand">
        <Link to="/" className="app-logo"><span className="app-logo-mark" aria-hidden="true"><i /></span>OwnChar</Link>
        <AppNav />
      </div>
    )
  }
  const action = collapsed ? '사이드바 열기' : '사이드바 닫기'
  return (
    <div className="rail-brand">
      <Hint label={action}>
        <button type="button" className="app-logo-mark" aria-label={action} aria-expanded={!collapsed} onClick={onToggle}><i /></button>
      </Hint>
      <Link to="/" className="rail-wordmark" tabIndex={collapsed ? -1 : undefined} aria-hidden={collapsed || undefined}>OwnChar</Link>
    </div>
  )
}
