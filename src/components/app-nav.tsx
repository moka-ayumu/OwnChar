import { Link } from '@tanstack/react-router'
import { CircleHelp } from 'lucide-react'

/** The two quiet links every page carries: help and the source. */
export function AppNav() {
  return (
    <nav className="app-nav">
      <Link to="/license"><CircleHelp className="size-4" /> 도움말</Link>
      <a href="https://github.com/moka-ayumu/OwnChar" target="_blank" rel="noreferrer">GitHub</a>
    </nav>
  )
}
