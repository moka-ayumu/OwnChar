import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Eye, Home, Type } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { exerciseCompletion, WRITING_EXERCISES, type GuideMode } from '@/collection/exercises';
import { missingPrompts } from '@/collection/prompts';
import { AppNav } from '@/components/app-nav';
import { Hint } from '@/components/hint';
import { ProgressRing } from '@/components/progress-ring';
import { flow } from '@/lib/flow';
import { cancelIdle, stopWhenBusy, whenIdle, type IdleHandle, type IdleTime } from '@/lib/idle';
import { useCompact } from '@/lib/use-compact';
import { useStableCallback } from '@/lib/use-stable-callback';
import { projectActions } from '@/project/store';
import { useProject } from '@/project/use-project';
import { CellPopover } from './cell-popover';
import { FixedCaptureLayer } from './fixed-capture-layer';
import { GenerationDialogs, type GenerationDialog } from './generation-dialogs';
import { ToolRail, type CanvasTool } from './tool-rail';
import { useWritingSession, warmSentence } from './use-writing-session';
import { WriteRail } from './write-rail';
import { WritingGrid } from './writing-grid';
import { WritingSurface, type WritingSurfaceHandle } from './writing-surface';

export interface WriteSearch {
	/** The sentence and cell to show, when arriving from a glyph's source link. */
	exerciseId?: string;
	cellIndex?: number;
	/** The glyph (and search text) to return to in the editor. */
	returnGlyph?: number;
	returnQuery?: string;
}

/** One 0 or 1 per cell: 1 for the cells in `indices`. */
function cellFlags(count: number, indices: number[]) {
	const flags = Array<string>(count).fill('0');
	for (const index of indices) flags[index] = '1';
	return flags.join('');
}

const RAIL_KEY = 'ownchar:write-rail';

function readRailCollapsed() {
	try {
		return window.localStorage.getItem(RAIL_KEY) === 'closed';
	} catch {
		return false;
	}
}

function writeRailCollapsed(collapsed: boolean) {
	try {
		window.localStorage.setItem(RAIL_KEY, collapsed ? 'closed' : 'open');
	} catch {
		// The rail's state is a per-device convenience; without storage it opens.
	}
}

export function WritePage(search: WriteSearch) {
	const storedIndex = useProject((state) => state.currentExercise);
	const sourceIndex = search.exerciseId ? WRITING_EXERCISES.findIndex((item) => item.id === search.exerciseId) : -1;
	const currentIndex = sourceIndex >= 0 ? sourceIndex : Math.min(storedIndex, WRITING_EXERCISES.length - 1);
	return <WriteSentence key={WRITING_EXERCISES[currentIndex].id} currentIndex={currentIndex} {...search} />;
}

function WriteSentence({ currentIndex, exerciseId: sourceExerciseId, cellIndex: sourceCellIndex, returnGlyph, returnQuery }: WriteSearch & { currentIndex: number }) {
	const navigate = useNavigate();
	const drawings = useProject((state) => state.drawings);
	const sessions = useProject((state) => state.writingSessions);
	const guideMode = useProject((state) => state.guideMode);
	const status = useProject((state) => state.status);
	const sourceDirty = useProject((state) => state.sourceDirty);
	const generatedFont = useProject((state) => state.generatedFont);
	const endpointStabilization = useProject((state) => state.compositionSettings.endpointStabilization);
	const modifiedGlyphCount = useProject((state) => Object.keys(state.glyphOverrides).length);
	const exercise = WRITING_EXERCISES[currentIndex];
	const viewport = useRef<HTMLDivElement>(null);
	const session = useWritingSession(exercise, viewport);
	const { grid, strokes } = session;
	const [strokeWidth, setStrokeWidth] = useState(3);
	const [tool, setTool] = useState<CanvasTool>('pen');
	const [generationDialog, setGenerationDialog] = useState<GenerationDialog>(null);
	const [railClosed, setRailClosed] = useState(readRailCollapsed);
	// A narrow screen lays the rail under the canvas as a bar, so it has no closed state there.
	const compact = useCompact();
	const railCollapsed = railClosed && !compact;
	const surface = useRef<WritingSurfaceHandle>(null);
	const stage = useRef<HTMLElement>(null);
	const frame = useRef<HTMLDivElement>(null);
	const region = useRef<HTMLDivElement>(null);
	const { active } = session;
	// A finished cell closes its popover, so the next cell is free to write in.
	const popoverOpen = active.cellIndex !== null && (active.current !== null || active.reopened);
	const writtenKey = cellFlags(
		exercise.cells.length,
		session.capture.groups.filter((group) => group.strokes.length).map((group) => group.cellIndex)
	);
	const finishedKey = session.finished.map((done) => (done ? '1' : '0')).join('');
	const writtenRoles = session.capture.groups
		.filter((group) => group.strokes.length && group.slot.role)
		.map((group) => `${group.cellIndex}:${group.slot.role}`)
		.join(',');
	const canvasWidth = grid.columns * grid.cellSize;
	const canvasHeight = session.rowCount * grid.cellSize;
	const showsSourceCell = sourceExerciseId === exercise.id && sourceCellIndex !== undefined && sourceCellIndex >= 0 && sourceCellIndex < exercise.cells.length;

	useEffect(() => {
		if (status === 'empty') void navigate({ to: '/' });
	}, [navigate, status]);

	// Arriving from a glyph's source link, bring its cell into view.
	useEffect(() => {
		if (!showsSourceCell || sourceCellIndex === undefined || !region.current) return;
		const row = Math.floor(sourceCellIndex / grid.columns);
		region.current.scrollTop = Math.max(0, row * grid.cellSize - region.current.clientHeight / 3);
	}, [showsSourceCell, sourceCellIndex, grid]);

	const compositionSettings = useProject((state) => state.compositionSettings);
	// Once the writer pauses, the other sentences get ready one idle task at a time, the nearest first.
	useEffect(() => {
		const others = WRITING_EXERCISES.map((_, index) => index).filter((index) => index !== currentIndex);
		const queue = others.sort((left, right) => Math.abs(left - currentIndex) - Math.abs(right - currentIndex) || right - left);
		let handle: IdleHandle = { id: 0 };
		const warm = (time: IdleTime) => {
			const index = queue[0];
			if (index === undefined) return;
			if (warmSentence(WRITING_EXERCISES[index], drawings, sessions, compositionSettings, guideMode, stopWhenBusy(time))) queue.shift();
			handle = whenIdle(warm);
		};
		const start = window.setTimeout(() => {
			handle = whenIdle(warm);
		}, 400);
		return () => {
			window.clearTimeout(start);
			cancelIdle(handle);
		};
	}, [currentIndex, drawings, sessions, compositionSettings, guideMode]);

	const setGuideMode = useStableCallback((mode: GuideMode) => projectActions.setGuideMode(mode));

	const toggleRail = useStableCallback(() => {
		setRailClosed(!railClosed);
		writeRailCollapsed(!railClosed);
	});

	const clear = useStableCallback(() => {
		surface.current?.clear();
		session.clear();
	});
	const undo = useStableCallback(() => surface.current?.undo());
	const redo = useStableCallback(() => surface.current?.redo());
	const reopenCell = useStableCallback((index: number) => session.reopenCell(index));
	const setEndpointStabilization = useStableCallback((value: number) => projectActions.updateCompositionSettings({ endpointStabilization: value }));

	const go = useStableCallback((index: number) => {
		const next = Math.max(0, Math.min(WRITING_EXERCISES.length - 1, index));
		projectActions.showExercise(next);
		if (sourceExerciseId) void navigate({ to: '/write', search: { returnGlyph, returnQuery } });
	});

	const remaining = missingPrompts(drawings);
	const exerciseProgress = exerciseCompletion(exercise, drawings, sessions[exercise.id], guideMode);

	const generate = () => {
		// Generation opens on the sentence exactly where it sits now.
		const stageBox = stage.current?.getBoundingClientRect();
		// The generation stage starts at the full rail width, further right than this one.
		const stageLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail')) || (stageBox?.left ?? 0);
		const frameBox = frame.current?.getBoundingClientRect();
		const clipBox = region.current?.getBoundingClientRect();
		flow.leaveWriting(
			stageBox && frameBox && clipBox && strokes.length
				? {
						exerciseId: exercise.id,
						frame: { x: frameBox.left - stageLeft, y: frameBox.top - stageBox.top, width: frameBox.width, height: frameBox.height },
						clip: { x: clipBox.left - stageLeft, y: Math.max(0, clipBox.top - stageBox.top), width: clipBox.width, height: Math.min(clipBox.bottom, stageBox.bottom) - Math.max(clipBox.top, stageBox.top) }
					}
				: null
		);
		void navigate({ to: '/generate', viewTransition: true });
	};
	const proceedToGeneration = () => {
		if (sourceDirty && modifiedGlyphCount > 0) setGenerationDialog('conflict');
		else generate();
	};
	const requestGeneration = useStableCallback(() => (remaining.length > 0 ? setGenerationDialog('missing') : proceedToGeneration()));
	const openExistingFont = useStableCallback(() => void (returnGlyph === undefined ? navigate({ to: '/preview', viewTransition: true }) : navigate({ to: '/edit', search: { glyph: returnGlyph, query: returnQuery } })));

	return (
		<div className="flow write-flow" data-collapsed={railCollapsed ? 'true' : undefined}>
			<WriteRail
				drawings={drawings}
				sessions={sessions}
				guideMode={guideMode}
				currentIndex={currentIndex}
				collapsed={railCollapsed}
				hasGeneratedFont={Boolean(generatedFont)}
				onToggle={toggleRail}
				onGo={go}
				onRequestGeneration={requestGeneration}
				onOpenExistingFont={openExistingFont}
			/>

			<section className="stage write-stage" ref={stage}>
				<ToolRail
					tool={tool}
					strokeWidth={strokeWidth}
					endpointStabilization={endpointStabilization}
					guideMode={guideMode}
					onTool={setTool}
					onStrokeWidth={setStrokeWidth}
					onGuideMode={setGuideMode}
					onEndpointStabilization={setEndpointStabilization}
					cellSize={grid.cellSize}
					cellSizeLocked={strokes.length > 0}
					onCellSize={session.setCellSize}
					onUndo={undo}
					onRedo={redo}
					onClear={clear}
				/>
				<div className="write-main">
					<div className="sentence-prompt">
						{/* At phone width the header is gone: the menu stands at the top left, as a phone's main menu does. */}
						<span className="prompt-menu">
							<AppNav
								showLinks={false}
								variant="menu"
								compactItems={
									<>
										<DropdownMenuItem className="compact-only" onSelect={() => void navigate({ to: '/' })}>
											<Home className="size-4" /> 처음 화면으로
										</DropdownMenuItem>
										<DropdownMenuItem className="compact-only" onSelect={requestGeneration}>
											<Type className="size-4" /> 지금 폰트 만들기
										</DropdownMenuItem>
										{generatedFont && (
											<DropdownMenuItem className="compact-only" onSelect={openExistingFont}>
												<Eye className="size-4" /> 기존 폰트 미리보기 · 편집
											</DropdownMenuItem>
										)}
									</>
								}
							/>
						</span>
						<h1>{exercise.text}</h1>
						<div>
							<Hint side="bottom" label={`${exerciseProgress.completed} / ${exerciseProgress.total} 자모`}>
								<button type="button" className="sentence-ring" aria-label={`이 문장에서 자모 ${exerciseProgress.completed} / ${exerciseProgress.total} 수집`}>
									<ProgressRing value={exerciseProgress.completed} total={exerciseProgress.total} size={22} />
								</button>
							</Hint>
							<AppNav showLinks={false} />
						</div>
					</div>
					<div className="sentence-canvas-region" ref={region}>
						<div className="sentence-canvas-scroll" ref={viewport}>
							<div
								className="sentence-canvas-frame"
								ref={frame}
								data-testid="writing-canvas"
								data-cell-size={grid.cellSize}
								data-columns={grid.columns}
								data-rows={session.rowCount}
								data-assignment-prompts={session.capture.assignments.map((item) => item.promptId).join(',')}
								style={{ width: canvasWidth, height: canvasHeight }}
							>
								<FixedCaptureLayer
									exercise={exercise}
									drawings={drawings}
									sessions={sessions}
									cellGuides={session.cellGuides}
									rule={session.fixedRule}
									writtenRoles={writtenRoles}
									showHints={guideMode === 'placement'}
									grid={grid}
									width={canvasWidth}
									height={canvasHeight}
								/>
								<WritingGrid
									exercise={exercise}
									cellSize={grid.cellSize}
									finished={finishedKey}
									written={writtenKey}
									activeCell={popoverOpen ? active.cellIndex : null}
									sourceCell={showsSourceCell ? (sourceCellIndex ?? null) : null}
									onReopen={reopenCell}
								/>
								<WritingSurface
									key={`${exercise.id}:${grid.columns}`}
									ref={surface}
									initialStrokes={strokes}
									cellSize={grid.cellSize}
									width={canvasWidth}
									height={canvasHeight}
									strokeWidth={strokeWidth}
									endpointStabilization={endpointStabilization}
									tool={tool}
									onChange={(next) => session.save(next)}
								/>
								{active.cellIndex !== null && popoverOpen && (
									<CellPopover
										key={active.cellIndex}
										cell={exercise.cells[active.cellIndex]}
										cellIndex={active.cellIndex}
										grid={grid}
										slots={active.slots}
										current={active.current}
										remaining={active.remaining}
										canFinish={active.canFinish}
										reopened={active.reopened}
										warning={session.boundaryWarning}
										onCollect={session.collectActiveSlot}
										onFinish={session.finishActiveSlot}
										onClose={session.closeCell}
									/>
								)}
							</div>
						</div>
					</div>
				</div>
			</section>

			<GenerationDialogs
				dialog={generationDialog}
				missing={remaining}
				modifiedGlyphCount={modifiedGlyphCount}
				onClose={() => setGenerationDialog(null)}
				onProceed={proceedToGeneration}
				onKeepEdits={generate}
				onDiscardEdits={() => {
					projectActions.clearGlyphTransformsForRecompose();
					generate();
				}}
			/>
		</div>
	);
}
