import { forwardRef, memo, useImperativeHandle, useRef, useState, type PointerEvent } from 'react';
import type { Point } from '@/font/geometry/path-ops';
import { penDiameter, strokeSvgPath, type RawStroke } from '@/font/stroke/outline';

export interface WritingSurfaceHandle {
	undo(): void;
	redo(): void;
	clear(): void;
}

interface Props {
	initialStrokes: readonly RawStroke[];
	cellSize: number;
	width: number;
	height: number;
	strokeWidth: number;
	endpointStabilization: number;
	tool: 'pen' | 'eraser' | 'pan';
	/** The point of the canvas at the top left of the surface. The default is the surface's own corner. */
	origin?: Point;
	onChange(strokes: readonly RawStroke[]): void;
}

interface Sample {
	point: Point;
	pressure: number;
}

const ORIGIN: Point = [0, 0];

const StrokePathView = memo(function StrokePathView({ stroke, cellSize, endpointStabilization }: { stroke: RawStroke; cellSize: number; endpointStabilization: number }) {
	return <path d={strokeSvgPath(stroke, cellSize, endpointStabilization)} transform={`translate(${stroke.x} ${stroke.y})`} fill="#101114" fillRule="nonzero" />;
});

/** `stroke` extended by the samples that moved the pen; the same stroke when none did. */
function withSamples(stroke: RawStroke, samples: Sample[]): RawStroke {
	const points = [...stroke.points];
	const pressures = [...stroke.pressures];
	for (const sample of samples) {
		const px = sample.point[0] - stroke.x;
		const py = sample.point[1] - stroke.y;
		const last = points.at(-1)!;
		if (Math.hypot(px - last[0], py - last[1]) < 0.25) continue;
		points.push([px, py]);
		pressures.push(sample.pressure);
	}
	if (points.length === stroke.points.length) return stroke;
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	return {
		...stroke,
		points,
		pressures,
		width: Math.max(...xs) - Math.min(...xs),
		height: Math.max(...ys) - Math.min(...ys),
		version: stroke.version + 1
	};
}

function distanceToStroke(stroke: RawStroke, x: number, y: number) {
	let nearest = Infinity;
	stroke.points.forEach(([px, py], index) => {
		const ax = stroke.x + px;
		const ay = stroke.y + py;
		nearest = Math.min(nearest, Math.hypot(ax - x, ay - y));
		if (index === 0) return;
		const bx = stroke.x + stroke.points[index - 1][0];
		const by = stroke.y + stroke.points[index - 1][1];
		const lengthSquared = (ax - bx) ** 2 + (ay - by) ** 2;
		const t = lengthSquared ? Math.max(0, Math.min(1, ((x - bx) * (ax - bx) + (y - by) * (ay - by)) / lengthSquared)) : 0;
		nearest = Math.min(nearest, Math.hypot(bx + t * (ax - bx) - x, by + t * (ay - by) - y));
	});
	return nearest;
}

export const WritingSurface = forwardRef<WritingSurfaceHandle, Props>(function WritingSurface({ initialStrokes, cellSize, width, height, strokeWidth, endpointStabilization, tool, origin = ORIGIN, onChange }, ref) {
	const [strokes, setStrokes] = useState<RawStroke[]>(() => initialStrokes.map((stroke) => ({ ...stroke })));
	const current = useRef(strokes);
	const past = useRef<RawStroke[][]>([]);
	const future = useRef<RawStroke[][]>([]);
	const pointer = useRef<{ id: number; strokeId?: string } | null>(null);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const brush = useRef<SVGGElement>(null);
	// At full pressure perfect-freehand draws a stroke whose radius equals `size`.
	const brushRadius = tool === 'eraser' ? Math.max(9, (strokeWidth / 6) * 5) : Math.max(1.5, penDiameter(strokeWidth / 6, cellSize));

	const moveBrush = (event: PointerEvent<SVGSVGElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		brush.current?.setAttribute('transform', `translate(${event.clientX - rect.left + origin[0]} ${event.clientY - rect.top + origin[1]})`);
		brush.current?.setAttribute('visibility', event.pointerType === 'touch' || tool === 'pan' ? 'hidden' : 'visible');
	};
	const hideBrush = () => brush.current?.setAttribute('visibility', 'hidden');

	const publish = (next: RawStroke[]) => {
		current.current = next;
		setStrokes(next);
		onChangeRef.current(next);
	};
	const checkpoint = () => {
		past.current.push(current.current);
		if (past.current.length > 50) past.current.shift();
		future.current = [];
	};
	useImperativeHandle(ref, () => ({
		undo() {
			const previous = past.current.pop();
			if (!previous) return;
			future.current.push(current.current);
			publish(previous);
		},
		redo() {
			const next = future.current.pop();
			if (!next) return;
			past.current.push(current.current);
			publish(next);
		},
		clear() {
			if (!current.current.length) return;
			checkpoint();
			publish([]);
		}
	}));

	const samples = (event: PointerEvent<SVGSVGElement>): Sample[] => {
		const rect = event.currentTarget.getBoundingClientRect();
		const native = event.nativeEvent;
		const coalesced = native.getCoalescedEvents?.() ?? [];
		return (coalesced.length ? coalesced : [native]).map((sample) => ({
			point: [sample.clientX - rect.left + origin[0], sample.clientY - rect.top + origin[1]],
			pressure: sample.pointerType === 'pen' ? sample.pressure : 1
		}));
	};
	const eraseAt = ([x, y]: Point) => {
		const next = current.current.map((stroke) => {
			if (stroke.isDeleted || distanceToStroke(stroke, x, y) > Math.max(9, stroke.strokeWidth * 5)) return stroke;
			return { ...stroke, isDeleted: true, version: stroke.version + 1 };
		});
		if (next.some((stroke, index) => stroke !== current.current[index])) publish(next);
	};
	/** Replaces the stroke being drawn; publishes only when it changed. */
	const updateActive = (change: (stroke: RawStroke) => RawStroke) => {
		const id = pointer.current?.strokeId;
		const next = current.current.map((stroke) => (stroke.id === id ? change(stroke) : stroke));
		if (next.some((stroke, index) => stroke !== current.current[index])) publish(next);
	};

	const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
		if (tool === 'pan' || event.button !== 0 || pointer.current) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		const rect = event.currentTarget.getBoundingClientRect();
		const point: Point = [event.clientX - rect.left + origin[0], event.clientY - rect.top + origin[1]];
		checkpoint();
		if (tool === 'eraser') {
			pointer.current = { id: event.pointerId };
			eraseAt(point);
			return;
		}
		const id = crypto.randomUUID();
		pointer.current = { id: event.pointerId, strokeId: id };
		publish([
			...current.current,
			{
				id,
				x: point[0],
				y: point[1],
				width: 0,
				height: 0,
				points: [[0, 0]],
				pressures: [event.pointerType === 'pen' ? event.pressure : 1],
				// Calibrate the slider so 3 produces the previous thickness of 1.5.
				strokeWidth: strokeWidth / 6,
				version: 1,
				lastCommittedPoint: null
			}
		]);
	};
	const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
		moveBrush(event);
		if (pointer.current?.id !== event.pointerId || !(event.buttons & 1)) return;
		const incoming = samples(event);
		if (pointer.current.strokeId) updateActive((stroke) => withSamples(stroke, incoming));
		else eraseAt(incoming.at(-1)!.point);
	};
	const onPointerEnd = (event: PointerEvent<SVGSVGElement>) => {
		if (pointer.current?.id !== event.pointerId) return;
		if (pointer.current.strokeId) {
			const incoming = samples(event);
			updateActive((stroke) => {
				const extended = withSamples(stroke, incoming);
				return { ...extended, lastCommittedPoint: extended.points.at(-1) ?? null, version: stroke.version + 1 };
			});
		}
		pointer.current = null;
	};

	return (
		<svg
			className="writing-surface"
			data-tool={tool}
			width={width}
			height={height}
			viewBox={`${origin[0]} ${origin[1]} ${width} ${height}`}
			aria-label="손글씨 입력 영역"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerEnd}
			onPointerCancel={onPointerEnd}
			onPointerLeave={hideBrush}
		>
			{strokes
				.filter((stroke) => !stroke.isDeleted)
				.map((stroke) => (
					<StrokePathView key={stroke.id} stroke={stroke} cellSize={cellSize} endpointStabilization={endpointStabilization} />
				))}
			<g ref={brush} visibility="hidden" pointerEvents="none" fill="none">
				<circle r={brushRadius + 0.5} stroke="#ffffff" strokeWidth={1} />
				<circle r={brushRadius} stroke="#101114" strokeWidth={1} />
			</g>
		</svg>
	);
});
