import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

type Side = 'right' | 'bottom' | 'left' | 'top';
type Tip = { owner: object; label: ReactNode; side: Side; box: DOMRect };

const HOVER_DELAY = 450;

const GroupContext = createContext<{ show(tip: Tip): void; hide(owner: object): void; warm(): boolean } | null>(null);

function placeOf(box: DOMRect, side: Side) {
	return side === 'right'
		? { left: box.right + 8, top: box.top + box.height / 2 }
		: side === 'left'
			? { left: box.left - 8, top: box.top }
			: side === 'top'
				? { left: box.left + box.width / 2, top: box.top - 8 }
				: { left: box.left + box.width / 2, top: box.bottom + 8 };
}

/**
 * Hints inside a group share one note. Moving from one to the next slides the note over,
 * and it fades away only when the pointer leaves them all.
 */
export function HintGroup({ children }: { children: ReactNode }) {
	const [tip, setTip] = useState<Tip | null>(null);
	const [open, setOpen] = useState(false);
	const owner = useRef<object | null>(null);
	const timer = useRef<number | undefined>(undefined);
	const mounted = useRef(false);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	const api = useMemo(
		() => ({
			warm: () => mounted.current,
			show(next: Tip) {
				window.clearTimeout(timer.current);
				mounted.current = true;
				owner.current = next.owner;
				setTip(next);
				setOpen(true);
			},
			hide(from: object) {
				if (owner.current !== from) return;
				owner.current = null;
				setOpen(false);
				timer.current = window.setTimeout(() => {
					mounted.current = false;
					setTip(null);
				}, 200);
			}
		}),
		[]
	);

	return (
		<GroupContext.Provider value={api}>
			{children}
			{tip &&
				createPortal(
					<span role="tooltip" className="hint" data-side={tip.side} data-open={open} data-group="" style={placeOf(tip.box, tip.side)}>
						{tip.label}
					</span>,
					document.body
				)}
		</GroupContext.Provider>
	);
}

/**
 * A short note shown beside what it wraps while that is hovered or focused.
 * Wrap a whole control group and the note stays up while any part of it is used,
 * including a slider drag that leaves the group.
 * It is drawn over the page, so a scrolling or clipping parent never cuts it.
 * A touch or pen press shows it for a moment. Nothing shows without a label.
 * With `contents` the wrapper takes no box, so a flex or grid parent lays out the child itself.
 */
export function Hint({ label, side = 'right', className, contents, children }: { label: ReactNode; side?: Side; className?: string; contents?: boolean; children: ReactNode }) {
	const group = useContext(GroupContext);
	const anchor = useRef<HTMLSpanElement>(null);
	const owner = useRef({});
	const timer = useRef<number | undefined>(undefined);
	const pressed = useRef(false);
	const [box, setBox] = useState<DOMRect | null>(null);

	useEffect(() => {
		const self = owner.current;
		return () => {
			window.clearTimeout(timer.current);
			group?.hide(self);
		};
	}, [group]);

	const show = () => {
		window.clearTimeout(timer.current);
		const target = contents ? anchor.current?.firstElementChild : anchor.current;
		const rect = target?.getBoundingClientRect() ?? null;
		if (!group) setBox(rect);
		else if (rect && label) group.show({ owner: owner.current, label, side, box: rect });
	};
	const hide = () => {
		window.clearTimeout(timer.current);
		if (group) group.hide(owner.current);
		else setBox(null);
	};

	// A press that starts inside keeps the note up until it lifts, wherever the pointer has gone.
	const press = () => {
		pressed.current = true;
		const release = (event: PointerEvent) => {
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
			pressed.current = false;
			if (event.pointerType === 'mouse' && !anchor.current?.matches(':hover')) hide();
		};
		window.addEventListener('pointerup', release);
		window.addEventListener('pointercancel', release);
	};

	return (
		<span
			ref={anchor}
			className={cn('hint-anchor', contents && 'hint-contents', className)}
			// A mouse must rest a moment before the note shows, unless a note in the group is already up.
			onPointerEnter={(event) => {
				window.clearTimeout(timer.current);
				if (event.pointerType === 'mouse' && !group?.warm()) timer.current = window.setTimeout(show, HOVER_DELAY);
				else show();
			}}
			onFocus={show}
			onBlur={hide}
			onPointerDown={press}
			// A finger or pen leaves as soon as it lifts; keep the note up long enough to read.
			onPointerLeave={(event) => {
				if (pressed.current) return;
				if (event.pointerType === 'mouse') hide();
				else timer.current = window.setTimeout(hide, 1800);
			}}
		>
			{children}
			{!group &&
				label &&
				box &&
				createPortal(
					<span role="tooltip" className="hint" data-side={side} style={placeOf(box, side)}>
						{label}
					</span>,
					document.body
				)}
		</span>
	);
}
