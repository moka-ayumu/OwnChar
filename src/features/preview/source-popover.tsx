import type { CSSProperties } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { customKind, CUSTOM_KIND_LABELS, type CustomGlyph } from '@/collection/custom-glyphs'
import { sessionCaptures, WRITING_EXERCISES } from '@/collection/exercises'
import { CustomThumb } from '@/features/editor/custom-thumb'
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records'
import { ROLE_LABELS } from '@/collection/prompts'
import type { CompositionSettings } from '@/font/settings'
import { glyphSources, type GlyphSource } from '@/generation/provenance'
import { compositionShapes } from '@/generation/use-composition-context'
import type { SourceItem } from './source-items'

type Drawings = Record<string, DrawingRecord>
type Sessions = Record<string, WritingSessionRecord>

/** The cell a jamo was written in: the jamo in ink, what else was written in the cell behind it. */
function SourceCell({ record, session, drawings }: { record: DrawingRecord; session: WritingSessionRecord; drawings: Drawings }) {
  const { exerciseId, cellIndex } = record.capture
  const others = sessionCaptures(exerciseId, session, drawings).filter((other) => other.capture.cellIndex === cellIndex && other.promptId !== record.promptId)
  const strokes = (drawing: DrawingRecord) => drawing.paths.map((path, index) => <path key={`${drawing.promptId}-${index}`} d={path.d} transform={`translate(${path.x} ${path.y})`} />)
  return (
    <svg className="source-cell" viewBox={`0 0 ${session.cellSize} ${session.cellSize}`} aria-hidden="true">
      <g opacity=".22">{others.map(strokes)}</g>
      {strokes(record)}
    </svg>
  )
}

function Source({ source, drawings, sessions }: { source: GlyphSource; drawings: Drawings; sessions: Sessions }) {
  const navigate = useNavigate()
  const record = drawings[source.originPromptId]
  const session = record && sessions[record.capture.exerciseId]
  const exercise = record && WRITING_EXERCISES.find((item) => item.id === record.capture.exerciseId)
  const label = `${source.symbol ? '기호' : source.role ? ROLE_LABELS[source.role] : '글자'} ${source.char}`
  if (!record || !session || !exercise) {
    return <div className="source-chip is-missing"><span className="source-cell" /><span><strong>{label}</strong><small>미작성</small></span></div>
  }
  const note = source.match === 'derived' ? ' · 다른 문맥에서 파생' : source.match === 'compound' ? ' · 자모 합성' : ''
  return (
    <button type="button" className="source-chip" onClick={() => void navigate({ to: '/write', search: { exerciseId: exercise.id, cellIndex: record.capture.cellIndex } })}>
      <SourceCell record={record} session={session} drawings={drawings} />
      <span><strong>{label}</strong><small>{exercise.title}{note}</small></span>
    </button>
  )
}

/** A glyph drawn whole: its strokes, and the way to the canvas it was drawn on. */
function CustomSource({ glyph, stabilization }: { glyph: CustomGlyph; stabilization: number }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="source-chip" onClick={() => void navigate({ to: '/edit', search: { custom: glyph.text } })}>
      <CustomThumb glyph={glyph} text={glyph.text} stabilization={stabilization} />
      <span><strong>직접 쓴 글자 {glyph.text}</strong><small>{CUSTOM_KIND_LABELS[customKind(glyph.text)]}</small></span>
    </button>
  )
}

/** Where the handwriting of the selected characters came from. Each source leads to the cell it was written in. */
export function SourcePopover({ items, hidden, drawings, sessions, settings, fontFamily, style, onClose }: {
  items: SourceItem[]
  /** Selected items that are not listed. */
  hidden: number
  drawings: Drawings
  sessions: Sessions
  settings: CompositionSettings
  fontFamily: string
  style: CSSProperties
  onClose(): void
}) {
  const shapes = compositionShapes(drawings, sessions, settings)
  return (
    <div className="source-popover" role="dialog" aria-label="원본 필기" style={style}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold">원본 필기 {hidden > 0 && <span className="font-normal text-ink-3">· 앞 {items.length}글자만</span>}</h2>
        <button type="button" className="source-popover-close" aria-label="닫기" onClick={onClose}><X className="size-3.5" /></button>
      </div>
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className="source-row">
          <span className="source-glyph" style={{ fontFamily }}>{item.text}</span>
          <div className="flex flex-wrap gap-1.5">
            {item.custom
              ? <CustomSource glyph={item.custom} stabilization={settings.endpointStabilization} />
              : glyphSources(item.text.codePointAt(0)!, drawings, shapes).map((source, part) => <Source key={part} source={source} drawings={drawings} sessions={sessions} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
