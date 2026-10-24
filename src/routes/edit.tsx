import { createFileRoute } from '@tanstack/react-router'
import { EditPage, type EditSearch } from '@/features/editor/edit-page'

export const Route = createFileRoute('/edit')({
  validateSearch: (search: Record<string, unknown>): EditSearch => ({
    glyph: typeof search.glyph === 'number' && Number.isInteger(search.glyph) ? search.glyph : undefined,
    query: typeof search.query === 'string' ? search.query : undefined,
    custom: typeof search.custom === 'string' ? search.custom : undefined,
  }),
  component: EditRoute,
})

function EditRoute() {
  return <EditPage {...Route.useSearch()} />
}
