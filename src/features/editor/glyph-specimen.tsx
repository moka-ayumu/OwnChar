import { useEffect, useMemo, useRef, useState } from 'react';
import type opentype from 'opentype.js';
import type { GlyphOverride } from '@/generation/request';

type Edge = 'left' | 'right' | 'y';
type Adjustment = Pick<GlyphOverride, 'left' | 'right' | 'y' | 'scale' | 'rotation'>;

/** The side bearing the composer gives every glyph in proportional width mode. */
const SIDE_BEARING = 55;
const SPAN_X = 1300;
const SPAN_Y = 1200;
const PAD = 28;

function pathData(commands: opentype.PathCommand[]) {
	return commands
		.map((command) => {
			if (command.type === 'Z') return 'Z';
			if (command.type === 'C') return `C${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
			if (command.type === 'Q') return `Q${command.x1} ${command.y1} ${command.x} ${command.y}`;
			return `${command.type}${command.x} ${command.y}`;
		})
		.join('');
}

/** Where the glyph of the current font ends up once `current` replaces what the font was made with. */
function adjust(box: opentype.BoundingBox, advance: number, current: Adjustment, made: Adjustment, proportional: boolean) {
	const scale = current.scale / made.scale;
	const rotation = current.rotation - made.rotation;
	const dy = current.y - made.y;
	const centerX = (box.x1 + box.x2) / 2;
	const centerY = (box.y1 + box.y2) / 2;
	const radians = (rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const corners = [
		[box.x1, box.y1],
		[box.x2, box.y1],
		[box.x1, box.y2],
		[box.x2, box.y2]
	].map(([x, y]) => {
		const dx = (x - centerX) * scale;
		const dyy = (y - centerY) * scale;
		return [dx * cos - dyy * sin + centerX, dx * sin + dyy * cos + centerY + dy];
	});
	const xs = corners.map(([x]) => x);
	const ys = corners.map(([, y]) => y);
	const x1 = Math.min(...xs);
	const x2 = Math.max(...xs);
	return {
		scale,
		rotation,
		dy,
		centerX,
		centerY,
		leftEdge: proportional ? x1 - SIDE_BEARING - current.left : made.left - current.left,
		rightEdge: proportional ? x2 + SIDE_BEARING + current.right : advance + current.right - made.right,
		topEdge: Math.max(...ys) + SIDE_BEARING
	};
}

/** One glyph drawn large, over a ghost of what the font holds now, with its margins and height as lines to drag. */
export function GlyphSpecimen({
	font,
	codePoint,
	specific,
	globalMetrics,
	made,
	proportional,
	onCommit
}: {
	font: opentype.Font;
	codePoint: number;
	specific: GlyphOverride;
	globalMetrics: { left: number; right: number; y: number };
	made: Adjustment;
	proportional: boolean;
	onCommit(patch: Partial<GlyphOverride>): void;
}) {
	const wrap = useRef<HTMLDivElement>(null);
	const drag = useRef<{ edge: Edge; x: number; y: number; from: number } | null>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	const [draft, setDraft] = useState<Partial<GlyphOverride> | null>(null);

	useEffect(() => {
		const element = wrap.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			const w = Math.round(entry.contentRect.width);
			const h = Math.round(entry.contentRect.height);
			setSize((previous) => (previous.w === w && previous.h === h ? previous : { w, h }));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const glyph = useMemo(() => {
		const source = font.charToGlyph(String.fromCodePoint(codePoint));
		const path = source.path;
		return { d: pathData(path.commands), box: path.getBoundingBox(), advance: source.advanceWidth ?? 0, empty: path.commands.length === 0 };
	}, [font, codePoint]);

	const shown = { ...specific, ...draft };
	const current: Adjustment = { left: globalMetrics.left + shown.left, right: globalMetrics.right + shown.right, y: globalMetrics.y + shown.y, scale: shown.scale, rotation: shown.rotation };
	const placed = adjust(glyph.box, glyph.advance, current, made, proportional);

	const k = Math.max(0.01, Math.min((size.w - 2 * PAD) / SPAN_X, (size.h - 2 * PAD) / SPAN_Y));
	const originX = size.w / 2 - ((glyph.box.x1 + glyph.box.x2) / 2) * k;
	const baselineY = size.h / 2 + ((glyph.box.y1 + glyph.box.y2) / 2) * k;
	const toX = (x: number) => originX + x * k;
	const toY = (y: number) => baselineY - y * k;

	const begin = (edge: Edge) => (event: React.PointerEvent<SVGGElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { edge, x: event.clientX, y: event.clientY, from: specific[edge] };
	};
	const move = (event: React.PointerEvent<SVGGElement>) => {
		const grab = drag.current;
		if (!grab) return;
		const units = grab.edge === 'y' ? (grab.y - event.clientY) / k : ((event.clientX - grab.x) / k) * (grab.edge === 'left' ? -1 : 1);
		setDraft({ [grab.edge]: Math.round(grab.from + units) });
	};
	const end = (event: React.PointerEvent<SVGGElement>) => {
		const grab = drag.current;
		drag.current = null;
		if (!grab) return;
		event.currentTarget.releasePointerCapture(event.pointerId);
		const value = draft?.[grab.edge];
		setDraft(null);
		if (value !== undefined && value !== specific[grab.edge]) onCommit({ [grab.edge]: value });
	};

	const grip = (edge: Edge, line: { x1: number; y1: number; x2: number; y2: number }, cursor: string) => (
		<g className="specimen-grip" data-active={draft?.[edge] !== undefined || undefined} style={{ cursor }} onPointerDown={begin(edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
			<line {...line} className="specimen-grip-hit" />
			<line {...line} className="specimen-grip-line" />
		</g>
	);

	return (
		<div ref={wrap} className="specimen">
			{size.w > 0 && (
				<svg width={size.w} height={size.h} className="specimen-svg" aria-hidden="true">
					<line x1={0} x2={size.w} y1={toY(0)} y2={toY(0)} className="specimen-baseline" />
					{!glyph.empty && (
						<g transform={`matrix(${k} 0 0 ${-k} ${originX} ${baselineY})`}>
							<path d={glyph.d} className="specimen-ghost" />
							<path
								d={glyph.d}
								className="specimen-ink"
								transform={`translate(0 ${placed.dy}) translate(${placed.centerX} ${placed.centerY}) rotate(${placed.rotation}) scale(${placed.scale}) translate(${-placed.centerX} ${-placed.centerY})`}
							/>
						</g>
					)}
					{!glyph.empty && (
						<>
							{grip('left', { x1: toX(placed.leftEdge), y1: 0, x2: toX(placed.leftEdge), y2: size.h }, 'ew-resize')}
							{grip('right', { x1: toX(placed.rightEdge), y1: 0, x2: toX(placed.rightEdge), y2: size.h }, 'ew-resize')}
							{grip('y', { x1: 0, y1: toY(placed.topEdge), x2: size.w, y2: toY(placed.topEdge) }, 'ns-resize')}
							<text x={toX(placed.leftEdge) - 6} y={size.h - 12} textAnchor="end" className="specimen-label">
								왼쪽 {shown.left}
							</text>
							<text x={toX(placed.rightEdge) + 6} y={size.h - 12} className="specimen-label">
								오른쪽 {shown.right}
							</text>
							<text x={size.w - PAD} y={toY(placed.topEdge) - 6} textAnchor="end" className="specimen-label">
								높이 {shown.y}
							</text>
						</>
					)}
					<g className="specimen-legend">
						<rect x={PAD} y={PAD - 10} width={10} height={10} className="specimen-ghost" />
						<text x={PAD + 16} y={PAD - 1}>
							현재 폰트
						</text>
						<rect x={PAD + 88} y={PAD - 10} width={10} height={10} className="specimen-ink" />
						<text x={PAD + 104} y={PAD - 1}>
							변경 후
						</text>
					</g>
				</svg>
			)}
		</div>
	);
}
