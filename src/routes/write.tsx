import { createFileRoute } from '@tanstack/react-router';
import { WritePage, type WriteSearch } from '@/features/writing/write-page';

const integer = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : undefined);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

export const Route = createFileRoute('/write')({
	validateSearch: (search: Record<string, unknown>): WriteSearch => ({
		exerciseId: text(search.exerciseId),
		cellIndex: integer(search.cellIndex),
		returnGlyph: integer(search.returnGlyph),
		returnQuery: text(search.returnQuery)
	}),
	component: WriteRoute
});

function WriteRoute() {
	return <WritePage {...Route.useSearch()} />;
}
