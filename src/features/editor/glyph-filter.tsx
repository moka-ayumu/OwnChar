import { Segmented } from '@/components/segmented';
import { Button } from '@/components/ui/button';
import { FINALS, INITIALS, MEDIALS } from '@/font/hangul';
import { NO_FILTER, VOWEL_SHAPES, isFiltering, type HangulFilter } from './glyph-categories';

export type HangulView = 'filter' | 'all';

const VIEWS = [
	['filter', '조합별'],
	['all', '전체 보기']
] as const;

const toggle = (list: string[], jamo: string) => (list.includes(jamo) ? list.filter((item) => item !== jamo) : [...list, jamo]);

function Chips({ label, jamo, chosen, onChange }: { label: string; jamo: string[]; chosen: string[]; onChange(next: string[]): void }) {
	return (
		<div role="group" aria-label={label} className="filter-row">
			<span className="input-label pt-1.5">{label}</span>
			<div className="filter-chips">
				{jamo.map((item) => (
					<button key={item || 'none'} type="button" className="filter-chip" aria-pressed={chosen.includes(item)} onClick={() => onChange(toggle(chosen, item))}>
						{item || '없음'}
					</button>
				))}
			</div>
		</div>
	);
}

/** Picks syllables by the jamo they hold; the result list is the syllables that match every part chosen. */
export function HangulTools({ view, onView, filter, onFilter, count, onSelectAll }: { view: HangulView; onView(view: HangulView): void; filter: HangulFilter; onFilter(filter: HangulFilter): void; count: number; onSelectAll(): void }) {
	const filtering = isFiltering(filter);
	return (
		<div className="mt-3">
			<div className="flex items-center justify-between gap-3">
				<Segmented options={VIEWS} value={view} onChange={onView} label="한글 보기" />
				{view === 'filter' && (
					<div className="flex items-center gap-1">
						<span className="tnum text-xs font-semibold text-ink-2">{count.toLocaleString()}자</span>
						<Button size="sm" variant="secondary" disabled={!filtering || count === 0} onClick={onSelectAll}>
							모두 선택
						</Button>
					</div>
				)}
			</div>
			{view === 'filter' && (
				<div className="glyph-filter">
					<div className="filter-shapes" role="group" aria-label="모음 형태">
						{VOWEL_SHAPES.map(([name, medials]) => {
							const on = medials.length === filter.medials.length && medials.every((item) => filter.medials.includes(item));
							return (
								<button key={name} type="button" className="filter-chip" aria-pressed={on} onClick={() => onFilter({ ...filter, medials: on ? [] : medials })}>
									{name}
								</button>
							);
						})}
						<Button className="ml-auto" size="sm" variant="ghost" disabled={!filtering} onClick={() => onFilter(NO_FILTER)}>
							해제
						</Button>
					</div>
					<Chips label="초성" jamo={INITIALS} chosen={filter.initials} onChange={(initials) => onFilter({ ...filter, initials })} />
					<Chips label="중성" jamo={MEDIALS} chosen={filter.medials} onChange={(medials) => onFilter({ ...filter, medials })} />
					<Chips label="받침" jamo={FINALS} chosen={filter.finals} onChange={(finals) => onFilter({ ...filter, finals })} />
				</div>
			)}
		</div>
	);
}
