import { useRef } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, CircleHelp, FolderOpen, Save, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ARCHIVE_EXTENSION, downloadProjectArchive, loadProjectArchive } from '@/project/archive'
import { deletePersistedProject, type SaveStatus } from '@/project/persistence'
import { projectStore } from '@/project/store'
import { useProject, useSaveStatus } from '@/project/use-project'

const SAVE_LABEL: Record<SaveStatus, string> = { saved: '자동 저장됨', saving: '저장 중…', failed: '저장 안 됨' }
const SAVE_NOTE: Record<SaveStatus, string> = {
  saved: '작업이 바뀔 때마다 이 기기의 브라우저에 저장돼요.',
  saving: '이 기기의 브라우저에 저장하고 있어요.',
  failed: '브라우저가 저장을 막고 있어요. 새로고침하면 작업이 사라지니 파일로 저장해 두세요.',
}

/** Whether the project in memory is on this device, as a dot and a short label. Nothing shows for an empty project. */
function SaveIndicator() {
  const status = useSaveStatus()
  const empty = useProject((state) => state.status === 'empty')
  if (empty) return null
  const label = SAVE_LABEL[status]
  return (
    <span className="save-indicator" data-status={status} role="status">
      <i aria-hidden="true" />
      <span>{label.replace('자동 ', '')}</span>
    </span>
  )
}

/** Save, open and delete of the project, kept together. */
function useProjectFile() {
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const empty = useProject((state) => state.status === 'empty')

  const open = async (file: File | undefined) => {
    if (!file) return
    if (!window.confirm('현재 작업을 지우고 파일의 작업으로 바꿀까요?')) return
    try {
      await loadProjectArchive(file)
      void navigate({ to: projectStore.state.status === 'ready' ? '/preview' : '/write' })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '파일을 불러오지 못했습니다.')
    }
  }

  const remove = async () => {
    if (!window.confirm('이 기기에 저장된 작업을 삭제할까요?\n삭제하면 되돌릴 수 없어요. 먼저 파일로 저장해 두면 나중에 불러올 수 있어요.')) return
    await deletePersistedProject()
    void navigate({ to: '/' })
  }

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={ARCHIVE_EXTENSION}
      hidden
      onChange={(event) => {
        void open(event.target.files?.[0])
        event.target.value = ''
      }}
    />
  )
  return {
    empty,
    fileInput,
    save: () => downloadProjectArchive(projectStore.state),
    pick: () => input.current?.click(),
    remove,
  }
}

/** The quiet links every page carries, with the save status and the project file actions folded into one menu. */
export function AppNav() {
  const file = useProjectFile()
  const status = useSaveStatus()

  return (
    <nav className="app-nav">
      <DropdownMenu>
        <DropdownMenuTrigger className="save-trigger" aria-label={`작업 저장 메뉴, ${SAVE_LABEL[status]}`} title={SAVE_LABEL[status]}>
          <SaveIndicator />
          {file.empty && <Save className="size-4" />}
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {!file.empty && (
            <>
              <DropdownMenuLabel data-status={status}>
                <b>{SAVE_LABEL[status]}</b>
                {SAVE_NOTE[status]}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem disabled={file.empty} onSelect={file.save}><Save className="size-4" /> 파일로 저장</DropdownMenuItem>
          <DropdownMenuItem onSelect={file.pick}><FolderOpen className="size-4" /> 파일에서 불러오기</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="danger" disabled={file.empty} onSelect={() => void file.remove()}><Trash2 className="size-4" /> 이 기기의 저장 내용 삭제</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {file.fileInput}
      <Link to="/license" aria-label="도움말"><CircleHelp className="size-4" /><span className="nav-label">도움말</span></Link>
      <a href="https://github.com/moka-ayumu/OwnChar" target="_blank" rel="noreferrer">GitHub</a>
    </nav>
  )
}
