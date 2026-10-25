import { memo, useMemo } from 'react';
import type { FixedRule, WritingExercise } from '@/collection/exercises';
import { cellOrigin, type DrawingRecord, type WritingSessionRecord } from '@/collection/records';
import { svgPathData } from '@/font/geometry/svg';
import type { GuideBox, StoredCellGuide } from '@/font/guides';
import { decomposeHangul, isHangulSyllable, type HangulRole } from '@/font/hangul';
import { fixedSlots, type CanvasGrid } from './stroke-assignment';

interface GuidePath {
	key: string;
	cellIndex: number;
	promptId: string;
	d: string;
	transform: string;
}
interface GuideHint {
	key: string;
	cellIndex: number;
	role: HangulRole;
	band?: boolean;
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Already collected jamo, drawn where the cell's guide puts them (see
 * `composeCellGuide`), and the places of the jamo still to be written.
 */
export const FixedCaptureLayer = memo(function FixedCaptureLayer({
	exercise,
	drawings,
	sessions,
	cellGuides,
	rule,
	writtenRoles,
	showHints,
	grid,
	width,
	height
}: {
	exercise: WritingExercise;
	drawings: Record<string, DrawingRecord>;
	/** Which slots each cell holds fixed. */
	rule: FixedRule;
	sessions: Record<string, WritingSessionRecord>;
	cellGuides: Map<number, StoredCellGuide>;
	/** The roles that have strokes, as `cellIndex:role` joined by commas. */
	writtenRoles: string;
	showHints: boolean;
	grid: CanvasGrid;
	width: number;
	height: number;
}) {
	const { cellSize, columns } = grid;
	const paths = useMemo(
		() =>
			exercise.cells.flatMap((cell, cellIndex): GuidePath[] => {
				const fixed = fixedSlots(cell, cellIndex, exercise, drawings, rule);
				if (!fixed.length) return [];
				const origin = cellOrigin(cellIndex, columns, cellSize);
				if (isHangulSyllable(cell.char.codePointAt(0)!)) {
					const guide = cellGuides.get(cellIndex);
					const scale = cellSize / 1000;
					return fixed.flatMap(({ slot, slotIndex }) => {
						const role = guide?.roles[slot.role!];
						return role
							? [
									{
										key: `${cellIndex}-${slotIndex}`,
										cellIndex,
										promptId: slot.promptId,
										// Guide outlines are in font coordinates (y up); the transform flips them.
										d: svgPathData(role.commands),
										transform: `matrix(${scale} 0 0 ${-scale} ${origin.x} ${origin.y + cellSize})`
									}
								]
							: [];
					});
				}
				// Other characters keep the captured outline where it was written.
				return fixed.flatMap(({ slot, slotIndex }) => {
					const record = drawings[slot.promptId];
					const scale = cellSize / sessions[record.capture.exerciseId].cellSize;
					return record.paths.map((path, pathIndex) => ({
						key: `${cellIndex}-${slotIndex}-${pathIndex}`,
						cellIndex,
						promptId: slot.promptId,
						d: path.d,
						transform: `matrix(${scale} 0 0 ${scale} ${origin.x + path.x * scale} ${origin.y + path.y * scale})`
					}));
				});
			}),
		[exercise, drawings, sessions, cellGuides, rule, cellSize, columns]
	);

	const hints = useMemo((): GuideHint[] => {
		if (!showHints) return [];
		const written = new Set(writtenRoles.split(','));
		const scale = cellSize / 1000;
		return [...cellGuides].flatMap(([cellIndex, guide]) => {
			const origin = cellOrigin(cellIndex, columns, cellSize);
			const rect = (box: GuideBox) => ({
				x: origin.x + box.x1 * scale,
				y: origin.y + cellSize - box.y2 * scale,
				width: (box.x2 - box.x1) * scale,
				height: (box.y2 - box.y1) * scale
			});
			const open = (Object.entries(guide.placeholders) as Array<[HangulRole, GuideBox]>).filter(([role]) => !written.has(`${cellIndex}:${role}`));
			// The empty initial and compound vowel nest, so together they are shown as one box.
			const initial = open.find(([role]) => role === 'initial')?.[1];
			const medial = open.find(([role]) => role === 'medial')?.[1];
			const nested = initial && medial && decomposeHangul(exercise.cells[cellIndex].char.codePointAt(0)!).kind === 'mixed';
			const places: Array<[HangulRole, GuideBox, GuideBox]> = open.flatMap(([role, box]) => {
				if (!nested) return [[role, box, guide.bands[role]!]];
				if (role === 'initial') return [];
				const bands = [guide.bands.initial!, guide.bands.medial!];
				return [
					[
						role,
						{
							x1: Math.min(initial!.x1, box.x1),
							y1: Math.min(initial!.y1, box.y1),
							x2: Math.max(initial!.x2, box.x2),
							y2: Math.max(initial!.y2, box.y2)
						},
						{
							x1: Math.min(...bands.map((band) => band.x1)),
							y1: Math.min(...bands.map((band) => band.y1)),
							x2: Math.max(...bands.map((band) => band.x2)),
							y2: Math.max(...bands.map((band) => band.y2))
						}
					]
				];
			});
			return places.flatMap(([role, box, band]) => [
				{ key: `${cellIndex}-${role}-band`, cellIndex, role, band: true, ...rect(band) },
				{ key: `${cellIndex}-${role}`, cellIndex, role, ...rect(box) }
			]);
		});
	}, [exercise, showHints, writtenRoles, cellGuides, cellSize, columns]);

	if (!paths.length && !hints.length) return null;
	return (
		<svg className="fixed-capture-layer" viewBox={`0 0 ${width} ${height}`} aria-label="이미 수집되어 고정된 자모">
			{hints.map((hint) => (
				<rect key={hint.key} className={hint.band ? 'placeholder-band' : 'placeholder-hint'} data-cell-index={hint.cellIndex} data-placeholder-role={hint.role} x={hint.x} y={hint.y} width={hint.width} height={hint.height} rx={4} />
			))}
			{paths.map((path) => (
				<path key={path.key} data-cell-index={path.cellIndex} data-prompt-id={path.promptId} d={path.d} transform={path.transform} fillRule="nonzero" />
			))}
		</svg>
	);
});
