import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Hint } from '@/components/hint';
import { Segmented } from '@/components/segmented';
import type { GlyphOverride } from '@/generation/request';
import { GLYPH_CATEGORIES, type GlyphCategory } from './glyph-categories';

const ARROW_STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 } as const;

/** The glyphs of one category as a virtual grid; click, Shift, Ctrl/⌘ and the arrow keys select. */
export function GlyphBrowser({
	category,
	onCategory,
	search,
	onSearch,
	tools,
	visible,
	selected,
	onSelect,
	overrides,
	fontFamily,
	columns
}: {
	category: GlyphCategory;
	onCategory(category: GlyphCategory): void;
	search: string;
	onSearch(search: string): void;
	tools?: React.ReactNode;
	visible: number[];
	selected: number[];
	onSelect(codePoints: number[]): void;
	overrides: Record<number, GlyphOverride>;
	fontFamily: string;
	columns: number;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const anchor = useRef(selected[0]);
	const first = useRef(selected[0]);
	const wantFocus = useRef(false);
	const [active, setActive] = useState(selected[0]);
	const selectedSet = useMemo(() => new Set(selected), [selected]);
	first.current = selected[0];

	const virtualizer = useVirtualizer({
		count: Math.ceil(visible.length / columns),
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 62,
		overscan: 6
	});

	useEffect(() => {
		const index = visible.indexOf(first.current);
		virtualizer.scrollToIndex(index > 0 ? Math.floor(index / columns) : 0, { align: 'center' });
	}, [visible, columns, virtualizer]);

	useEffect(() => {
		if (!wantFocus.current) return;
		const cell = scrollRef.current?.querySelector<HTMLElement>(`[data-cp="${active}"]`);
		if (!cell) return;
		wantFocus.current = false;
		cell.focus();
	});

	const choose = (codePoint: number, mode: 'one' | 'range' | 'toggle') => {
		setActive(codePoint);
		if (mode === 'range') {
			const from = visible.indexOf(anchor.current);
			const to = visible.indexOf(codePoint);
			if (from >= 0 && to >= 0) {
				onSelect(visible.slice(Math.min(from, to), Math.max(from, to) + 1));
				return;
			}
		}
		anchor.current = codePoint;
		if (mode === 'toggle') {
			const next = selectedSet.has(codePoint) ? selected.filter((item) => item !== codePoint) : [...selected, codePoint];
			if (next.length) onSelect(next);
		} else {
			onSelect([codePoint]);
		}
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		const direction = ARROW_STEPS[event.key as keyof typeof ARROW_STEPS];
		const index = visible.indexOf(active);
		if (!direction || index < 0) return;
		const step = event.key === 'ArrowUp' || event.key === 'ArrowDown' ? direction * columns : direction;
		const nextIndex = Math.max(0, Math.min(visible.length - 1, index + step));
		event.preventDefault();
		choose(visible[nextIndex], event.shiftKey ? 'range' : 'one');
		virtualizer.scrollToIndex(Math.floor(nextIndex / columns));
		wantFocus.current = true;
	};

	const tabStop = visible.includes(active) ? active : visible[0];

	return (
		<div className="glyph-browser">
			<div className="glyph-browser-head">
				<Hint className="block" side="right" label="Shift: 범위 선택 · Ctrl/⌘: 추가·제외">
					<div className="flex items-center gap-3">
						<input className="text-input" value={search} maxLength={1} placeholder="문자 검색" aria-label="문자 검색" onChange={(event) => onSearch(event.target.value)} />
						<span className="tnum shrink-0 text-xs font-semibold text-ink-2">{selected.length.toLocaleString()}개 선택</span>
					</div>
				</Hint>
				<Segmented className="mt-3 w-full" options={GLYPH_CATEGORIES} value={category} onChange={onCategory} label="글자 종류" />
				{tools}
			</div>
			<div ref={scrollRef} className="glyph-browser-scroll" role="group" aria-label="글리프 목록" onKeyDown={onKeyDown}>
				<div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
					{virtualizer.getVirtualItems().map((row) => (
						<div key={row.key} className="grid gap-1 px-3" style={{ position: 'absolute', transform: `translateY(${row.start}px)`, width: '100%', height: row.size, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
							{visible.slice(row.index * columns, row.index * columns + columns).map((codePoint) => {
								const pick = (
									<button
										type="button"
										data-cp={codePoint}
										tabIndex={codePoint === tabStop ? 0 : -1}
										aria-pressed={selectedSet.has(codePoint)}
										data-modified={overrides[codePoint] ? '' : undefined}
										className="glyph-pick"
										style={{ fontFamily }}
										onClick={(event) => choose(codePoint, event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'one')}
									>
										{String.fromCodePoint(codePoint)}
									</button>
								);
								return overrides[codePoint] ? (
									<Hint key={codePoint} contents side="top" label="고급 편집에서 수정됨">
										{pick}
									</Hint>
								) : (
									<Fragment key={codePoint}>{pick}</Fragment>
								);
							})}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
