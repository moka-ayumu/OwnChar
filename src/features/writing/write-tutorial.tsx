import { useEffect, useState } from 'react';
import type { WritingExercise } from '@/collection/exercises';
import { Button } from '@/components/ui/button';
import { HOME_SCENES } from '@/features/home/home-film';
import { loadSampleSession, type SampleSession } from '@/features/samples/sample-projects';
import { penDiameter, strokeSvgPath } from '@/font/stroke/outline';
import { projectStore } from '@/project/store';
import { cellIndexOf, visibleStrokes, type CanvasGrid } from './stroke-assignment';

const STORAGE_KEY = 'ownchar:write-tutorial';
/** Cells of the example the pen writes. */
const SAMPLE_CELLS = 2;
/** Sample pixels the pen covers in a second, and the pause between two strokes. */
const PEN_SPEED = 300;
const PEN_PAUSE = 0.18;
/** Seconds the finished cells stay before the pen writes them again. */
const HOLD = 1.8;
/** Stroke width of the reveal, in pen diameters; wide enough to fill the outline it is clipped to. */
const REVEAL = 2.4;

const SCENE = HOME_SCENES[0];

interface TutorialStroke {
	key: string;
	cell: number;
	outline: string;
	x: number;
	y: number;
	points: string;
	width: number;
	start: number;
	duration: number;
}

interface Tutorial {
	size: number;
	cells: number[];
	strokes: TutorialStroke[];
	/** Seconds the pen takes for all strokes. */
	length: number;
}

let closedThisSession = false;

/** Whether this device has not yet seen the tutorial. */
export function tutorialPending() {
	if (closedThisSession) return false;
	try {
		return window.localStorage.getItem(STORAGE_KEY) !== 'seen';
	} catch {
		return true;
	}
}

function markSeen() {
	closedThisSession = true;
	try {
		window.localStorage.setItem(STORAGE_KEY, 'seen');
	} catch {
		// Without storage the tutorial stays closed until the page is reloaded.
	}
}

/** The first cells of the example sentence as strokes, in the pixels of the example's cells. */
function prepare(session: SampleSession, exercise: WritingExercise): Tutorial {
	const size = session.cellSize;
	const grid: CanvasGrid = { cellSize: size, columns: session.columns };
	const strokes = visibleStrokes(session.elements).filter((stroke) => stroke.points.length > 1);
	const cellOf = (stroke: (typeof strokes)[number]) => cellIndexOf(stroke, grid, exercise.cells.length);
	const cells = [...new Set(strokes.map(cellOf))].slice(0, SAMPLE_CELLS).sort((a, b) => a - b);
	const stabilization = projectStore.state.compositionSettings.endpointStabilization;

	let clock = 0;
	const drawn = strokes
		.filter((stroke) => cells.includes(cellOf(stroke)))
		.map((stroke): TutorialStroke => {
			const cell = cellOf(stroke);
			const ox = (cell % grid.columns) * size;
			const oy = Math.floor(cell / grid.columns) * size;
			const length = stroke.points.reduce((sum, [x, y], index) => (index ? sum + Math.hypot(x - stroke.points[index - 1][0], y - stroke.points[index - 1][1]) : 0), 0);
			const duration = Math.max(0.2, length / PEN_SPEED);
			const item: TutorialStroke = {
				key: stroke.id,
				cell,
				outline: strokeSvgPath(stroke, size, stabilization),
				x: stroke.x - ox,
				y: stroke.y - oy,
				points: stroke.points.map(([x, y]) => `${stroke.x - ox + x},${stroke.y - oy + y}`).join(' '),
				width: penDiameter(stroke.strokeWidth, size) * REVEAL,
				start: clock,
				duration
			};
			clock += duration + PEN_PAUSE;
			return item;
		});

	return { size, cells, strokes: drawn, length: clock };
}

function prefersStill() {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A guide for a writer with nothing written: the pen of the example handwriting writes the first cells in a
 * light ink on the real grid, and a popover beside them says what to do. Closing it counts as seen.
 */
export function WriteTutorial({ exercise, grid, width, height, written, onClose }: { exercise: WritingExercise; grid: CanvasGrid; width: number; height: number; written: boolean; onClose(): void }) {
	const [tutorial, setTutorial] = useState<Tutorial | null>(null);
	const [round, setRound] = useState(0);
	const [still] = useState(prefersStill);

	const close = () => {
		markSeen();
		onClose();
	};

	useEffect(() => {
		let cancelled = false;
		void loadSampleSession(exercise.id).then((session) => {
			if (!cancelled && session) setTutorial(prepare(session, exercise));
		});
		return () => {
			cancelled = true;
		};
	}, [exercise]);

	// The pen writes the cells again after a pause.
	useEffect(() => {
		if (!tutorial || still) return;
		const timer = window.setTimeout(() => setRound((value) => value + 1), (tutorial.length + HOLD) * 1000);
		return () => window.clearTimeout(timer);
	}, [tutorial, round, still]);

	// The first stroke the writer makes closes it.
	useEffect(() => {
		if (!written) return;
		markSeen();
		onClose();
	}, [written, onClose]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			markSeen();
			onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	if (!tutorial) return null;

	const scale = grid.cellSize / tutorial.size;
	const place = (cell: number) => `translate(${(cell % grid.columns) * grid.cellSize} ${Math.floor(cell / grid.columns) * grid.cellSize}) scale(${scale})`;
	// The popover stands under the first written cell, at its left edge.
	const first = tutorial.cells[0];
	const left = (first % grid.columns) * grid.cellSize;
	const top = (Math.floor(first / grid.columns) + 1) * grid.cellSize + 8;

	return (
		<>
			<svg className="tutorial-ink" width={width} height={height} aria-hidden="true">
				{tutorial.cells.map((cell) => (
					<g key={`${cell}:${round}`} transform={place(cell)}>
						{tutorial.strokes
							.filter((stroke) => stroke.cell === cell)
							.map((stroke) => (
								<g key={stroke.key}>
									<clipPath id={`tutorial-${stroke.key}`}>
										<path d={stroke.outline} transform={`translate(${stroke.x} ${stroke.y})`} />
									</clipPath>
									<g clipPath={`url(#tutorial-${stroke.key})`}>
										<polyline
											className="tutorial-stroke"
											data-writing={still ? undefined : 'true'}
											points={stroke.points}
											pathLength={1}
											strokeWidth={stroke.width}
											style={{ ['--start' as string]: `${stroke.start}s`, ['--duration' as string]: `${stroke.duration}s` }}
										/>
									</g>
								</g>
							))}
					</g>
				))}
			</svg>
			<div className="tutorial-card" role="dialog" aria-label="쓰기 안내" style={{ left, top }}>
				<strong>{SCENE.name}</strong>
				<p>{SCENE.note}</p>
				<Button size="sm" autoFocus onClick={close}>
					확인
				</Button>
			</div>
		</>
	);
}
