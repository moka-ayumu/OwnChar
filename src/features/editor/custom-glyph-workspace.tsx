import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { CircleHelp, Crosshair, Eraser, Hand, PenLine, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import { customChars, customKind, CUSTOM_CELL_SIZE, CUSTOM_KIND_LABELS, isCustomText, MAX_CUSTOM_LENGTH, RECOMMENDED_CUSTOM, type CustomGlyph } from '@/collection/custom-glyphs';
import { Hint } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { WritingSurface, type WritingSurfaceHandle } from '@/features/writing/writing-surface';
import type { Point } from '@/font/geometry/path-ops';
import type { RawStroke } from '@/font/stroke/outline';
import { useStableCallback } from '@/lib/use-stable-callback';
import { projectActions } from '@/project/store';
import { CustomThumb } from './custom-thumb';

/** How long the strokes rest before they are kept: a stroke is not saved while the pen is still moving through it. */
const SAVE_DELAY = 500;
const STROKE_WIDTH = 3;

const tagOf = (text: string) => CUSTOM_KIND_LABELS[customKind(text)];

const CustomRow = memo(function CustomRow({
	text,
	glyph,
	selected,
	stabilization,
	onSelect,
	onRemove
}: {
	text: string;
	glyph: CustomGlyph | undefined;
	selected: boolean;
	stabilization: number;
	onSelect(text: string): void;
	onRemove(text: string): void;
}) {
	return (
		<li className="custom-row" data-selected={selected ? '' : undefined}>
			<button type="button" className="custom-row-main" aria-pressed={selected} onClick={() => onSelect(text)}>
				<CustomThumb glyph={glyph} text={text} stabilization={stabilization} />
				<span className="custom-row-text">{text}</span>
				<span className="custom-tag">{tagOf(text)}</span>
			</button>
			<Button size="icon" variant="ghost" className="custom-remove" aria-label={`${text} 삭제`} onClick={() => onRemove(text)}>
				<Trash2 className="size-4" />
			</Button>
		</li>
	);
});

interface View {
	size: Point;
	/** The point of the canvas at the top left of the view. */
	origin: Point;
}

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** What the view looks at: the ink, or the band of one cell for each character while nothing is written. */
function focusBox(text: string, elements: readonly RawStroke[]): Box {
	const box: Box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
	for (const stroke of elements) {
		if (stroke.isDeleted) continue;
		for (const [x, y] of stroke.points) {
			box.left = Math.min(box.left, stroke.x + x);
			box.right = Math.max(box.right, stroke.x + x);
			box.top = Math.min(box.top, stroke.y + y);
			box.bottom = Math.max(box.bottom, stroke.y + y);
		}
	}
	return box.left <= box.right ? box : { left: 0, top: 0, right: customChars(text).length * CUSTOM_CELL_SIZE, bottom: CUSTOM_CELL_SIZE };
}

/** The origin that puts the middle of `box` in the middle of a view of `size`. */
const centeredOrigin = (box: Box, size: Point): Point => [(box.left + box.right - size[0]) / 2, (box.top + box.bottom - size[1]) / 2];

/**
 * An endless canvas: it is panned in every direction, with the wheel, the hand tool or the middle button.
 * The band of one cell marks the height a glyph has; the font's own glyph stands in it as a guide.
 */
function CustomCanvas({ text, glyph, stabilization }: { text: string; glyph: CustomGlyph | undefined; stabilization: number }) {
	const surface = useRef<WritingSurfaceHandle>(null);
	const pending = useRef<readonly RawStroke[] | null>(null);
	const timer = useRef<number | undefined>(undefined);
	const well = useRef<HTMLDivElement>(null);
	const drag = useRef<{ id: number; x: number; y: number } | null>(null);
	const [tool, setTool] = useState<'pen' | 'eraser' | 'pan'>('pen');
	const [space, setSpace] = useState(false);
	// The space bar holds the hand tool while it is down.
	const active = space ? 'pan' : tool;
	const [view, setView] = useState<View | null>(null);

	const [focus, setFocus] = useState(() => focusBox(text, glyph?.elements ?? []));
	const lookAt = useStableCallback(() => focusBox(text, pending.current ?? glyph?.elements ?? []));
	// What the view looks at is out of sight. The box follows the writing once the pen has rested.
	const away =
		view !== null &&
		(() => {
			const box = focus;
			return view.origin[0] > box.right || view.origin[0] + view.size[0] < box.left || view.origin[1] > box.bottom || view.origin[1] + view.size[1] < box.top;
		})();

	const moveView = (dx: number, dy: number) => setView((previous) => previous && { ...previous, origin: [previous.origin[0] + dx, previous.origin[1] + dy] });

	useEffect(() => {
		const element = well.current;
		if (!element) return;
		const measure = () =>
			setView((previous) => {
				const size: Point = [element.clientWidth, element.clientHeight];
				return previous ? { ...previous, size } : { size, origin: centeredOrigin(lookAt(), size) };
			});
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			moveView(event.deltaX, event.deltaY);
		};
		element.addEventListener('wheel', wheel, { passive: false });
		return () => {
			observer.disconnect();
			element.removeEventListener('wheel', wheel);
		};
	}, [lookAt]);

	useEffect(() => {
		const editing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
		const down = (event: KeyboardEvent) => {
			if (event.code !== 'Space' || editing(event.target)) return;
			event.preventDefault();
			setSpace(true);
		};
		const up = (event: KeyboardEvent) => {
			if (event.code === 'Space') setSpace(false);
		};
		const release = () => setSpace(false);
		window.addEventListener('keydown', down);
		window.addEventListener('keyup', up);
		window.addEventListener('blur', release);
		return () => {
			window.removeEventListener('keydown', down);
			window.removeEventListener('keyup', up);
			window.removeEventListener('blur', release);
		};
	}, []);

	const startPan = (event: PointerEvent<HTMLDivElement>) => {
		if (active !== 'pan' && event.button !== 1) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
	};
	const pan = (event: PointerEvent<HTMLDivElement>) => {
		const start = drag.current;
		if (!start || start.id !== event.pointerId) return;
		moveView(start.x - event.clientX, start.y - event.clientY);
		drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
	};
	const endPan = (event: PointerEvent<HTMLDivElement>) => {
		if (drag.current?.id === event.pointerId) drag.current = null;
	};

	const flush = useStableCallback(() => {
		window.clearTimeout(timer.current);
		const elements = pending.current;
		pending.current = null;
		if (elements) {
			projectActions.saveCustomGlyph({ text, elements, cellSize: CUSTOM_CELL_SIZE, updatedAt: Date.now() });
			setFocus(focusBox(text, elements));
		}
	});
	useEffect(() => flush, [flush]);

	return (
		<>
			<div className="custom-pane-head">
				<div className="flex items-center gap-3">
					<h2 className="custom-title">{text}</h2>
					<span className="custom-tag">{tagOf(text)}</span>
				</div>
			</div>
			<div
				ref={well}
				className="custom-well"
				data-tool={active}
				style={view ? { backgroundPosition: `${-view.origin[0]}px ${-view.origin[1]}px` } : undefined}
				onPointerDown={startPan}
				onPointerMove={pan}
				onPointerUp={endPan}
				onPointerCancel={endPan}
			>
				<div className="custom-tools" role="toolbar" aria-orientation="vertical" aria-label="쓰기 도구" onPointerDown={(event) => event.stopPropagation()}>
					<Button size="icon" variant={active === 'pen' ? 'default' : 'ghost'} aria-pressed={active === 'pen'} aria-label="펜" title="펜" onClick={() => setTool('pen')}>
						<PenLine className="size-[18px]" />
					</Button>
					<Button size="icon" variant={active === 'eraser' ? 'default' : 'ghost'} aria-pressed={active === 'eraser'} aria-label="지우개" title="지우개" onClick={() => setTool('eraser')}>
						<Eraser className="size-[18px]" />
					</Button>
					<Button size="icon" variant={active === 'pan' ? 'default' : 'ghost'} aria-pressed={active === 'pan'} aria-label="화면 이동" title="화면 이동" onClick={() => setTool('pan')}>
						<Hand className="size-[18px]" />
					</Button>
					<span className="tool-rail-divider" aria-hidden="true" />
					<Button size="icon" variant="ghost" aria-label="실행 취소" title="실행 취소" onClick={() => surface.current?.undo()}>
						<Undo2 className="size-[18px]" />
					</Button>
					<Button size="icon" variant="ghost" aria-label="다시 실행" title="다시 실행" onClick={() => surface.current?.redo()}>
						<Redo2 className="size-[18px]" />
					</Button>
					<span className="tool-rail-divider" aria-hidden="true" />
					<Button size="icon" variant="ghost" aria-label="모두 지우기" title="모두 지우기" onClick={() => surface.current?.clear()}>
						<Trash2 className="size-[18px]" />
					</Button>
				</div>
				{view && away && (
					<Button className="custom-home" variant="secondary" onPointerDown={(event) => event.stopPropagation()} onClick={() => setView({ ...view, origin: centeredOrigin(lookAt(), view.size) })}>
						<Crosshair className="size-4" /> 처음 위치로
					</Button>
				)}
				{view && (
					<>
						<div className="custom-band" style={{ top: -view.origin[1], height: CUSTOM_CELL_SIZE }} aria-hidden="true" />
						<WritingSurface
							ref={surface}
							initialStrokes={glyph?.elements ?? []}
							cellSize={CUSTOM_CELL_SIZE}
							width={view.size[0]}
							height={view.size[1]}
							origin={view.origin}
							strokeWidth={STROKE_WIDTH}
							endpointStabilization={stabilization}
							tool={active}
							onChange={(next) => {
								pending.current = next;
								window.clearTimeout(timer.current);
								timer.current = window.setTimeout(flush, SAVE_DELAY);
							}}
						/>
					</>
				)}
			</div>
		</>
	);
}

/** The glyphs the writer draws whole: fixed over a composed one, added to the font, or standing for a run of characters. */
export function CustomWorkspace({ customGlyphs, fontFamily, stabilization, initialText, onOpenGuide }: { customGlyphs: Record<string, CustomGlyph>; fontFamily: string; stabilization: number; initialText?: string; onOpenGuide(): void }) {
	const [input, setInput] = useState('');
	const [selected, setSelected] = useState<string | null>(initialText && isCustomText(initialText) ? initialText : null);
	const [removing, setRemoving] = useState<string | null>(null);

	const written = useMemo(() => Object.values(customGlyphs).sort((a, b) => a.text.localeCompare(b.text)), [customGlyphs]);
	const draft = selected !== null && !(selected in customGlyphs) ? selected : null;
	const suggestions = RECOMMENDED_CUSTOM.filter((text) => !(text in customGlyphs));
	const valid = isCustomText(input);

	const [seenText, setSeenText] = useState(initialText);
	if (initialText !== seenText) {
		setSeenText(initialText);
		if (initialText && isCustomText(initialText)) setSelected(initialText);
	}

	const select = useStableCallback((text: string) => setSelected(text));
	const remove = useStableCallback((text: string) => {
		if (text in customGlyphs) setRemoving(text);
		else if (selected === text) setSelected(null);
	});
	const add = (text: string) => {
		if (!isCustomText(text)) return;
		setSelected(text);
		setInput('');
	};

	return (
		<div className="custom-workspace">
			<div className="custom-side">
				<Hint className="block" side="right" label="한 글자는 자동 조합 글자를 대체하거나 없는 글자를 추가하고, 2자에서 4자는 합자로 한 글자가 됩니다.">
					<form
						className="custom-side-head"
						onSubmit={(event) => {
							event.preventDefault();
							add(input.trim());
						}}
					>
						<label className="input-label" htmlFor="custom-text">
							글자 입력
						</label>
						<div className="custom-add">
							<input id="custom-text" className="text-input" value={input} maxLength={MAX_CUSTOM_LENGTH * 2} autoComplete="off" autoFocus={initialText === ''} onChange={(event) => setInput(event.target.value)} placeholder="ㅋㅋ" />
							<Button type="submit" disabled={!valid} aria-label="글자 추가">
								<Plus className="size-4" /> 추가
							</Button>
							<Button type="button" size="icon" variant="ghost" aria-label="사용 안내" title="사용 안내" onClick={onOpenGuide}>
								<CircleHelp className="size-[18px]" />
							</Button>
						</div>
					</form>
				</Hint>
				<ul className="custom-list" aria-label="직접 쓴 글자">
					{draft && <CustomRow key={draft} text={draft} glyph={undefined} selected stabilization={stabilization} onSelect={select} onRemove={remove} />}
					{written.map((glyph) => (
						<CustomRow key={glyph.text} text={glyph.text} glyph={glyph} selected={selected === glyph.text} stabilization={stabilization} onSelect={select} onRemove={remove} />
					))}
				</ul>
			</div>

			<section className="custom-pane" aria-label="쓰기">
				{selected !== null ? (
					<CustomCanvas key={selected} text={selected} glyph={customGlyphs[selected]} stabilization={stabilization} />
				) : (
					<div className="custom-empty">
						<h2 className="text-lg font-bold tracking-[-0.02em]">추천 예시</h2>
						<div className="custom-suggest">
							{suggestions.map((text) => (
								<button key={text} type="button" onClick={() => add(text)}>
									<span style={{ fontFamily }}>{text}</span>
									<small>{tagOf(text)}</small>
								</button>
							))}
						</div>
					</div>
				)}
			</section>

			<Dialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null);
				}}
			>
				<DialogContent>
					<DialogTitle>직접 쓴 글자를 삭제하시겠습니까?</DialogTitle>
					<DialogDescription>‘{removing}’을(를) 삭제하면 변경 적용 후 자동 조합 글자로 돌아갑니다.</DialogDescription>
					<div className="mt-6 flex justify-end gap-2">
						<Button variant="secondary" onClick={() => setRemoving(null)}>
							취소
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								if (removing === null) return;
								projectActions.removeCustomGlyph(removing);
								if (selected === removing) setSelected(null);
								setRemoving(null);
							}}
						>
							삭제
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
