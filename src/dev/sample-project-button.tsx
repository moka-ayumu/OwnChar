import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FlaskConical, X } from 'lucide-react'
import { clearPersistedProject } from '@/project/persistence'
import { joinProject, type SavedProject } from '@/project/saved-format'
import { projectActions } from '@/project/store'
import { SCHEMA_VERSION } from '@/project/types'

// Optional: the file is gitignored, so a fresh clone simply has no sample to load.
const samples = import.meta.glob<SavedProject>('./sample-project.json', { import: 'default' })

/** Dev-only floating button that fills the project with the sample data. Dismiss it with the X until the next reload. */
export function SampleProjectButton() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(true)
  const [loading, setLoading] = useState(false)
  const load = samples['./sample-project.json']
  if (!visible || !load) return null

  const apply = async () => {
    if (!window.confirm('현재 작업을 지우고 샘플 데이터로 채울까요?')) return
    setLoading(true)
    try {
      const sample = await load()
      await clearPersistedProject()
      // The sample has no binary font, so it resumes from the writing step and regenerates.
      projectActions.restoreProject({ ...joinProject(sample, null), schemaVersion: SCHEMA_VERSION, status: 'writing', fontDirty: true, sourceDirty: true })
      void navigate({ to: '/write' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center overflow-hidden rounded-md border border-ink bg-white text-xs font-semibold">
      <button className="inline-flex items-center gap-1.5 py-2 pl-3 pr-2 font-medium hover:bg-ground disabled:opacity-50" disabled={loading} onClick={() => void apply()}>
        <FlaskConical className="size-3.5" /> {loading ? '불러오는 중…' : '샘플 데이터 채우기'}
      </button>
      <button aria-label="닫기" className="py-2 pl-1 pr-2.5 text-ink-2 hover:text-ink" onClick={() => setVisible(false)}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}
