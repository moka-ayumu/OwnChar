import { memo } from 'react';
import type { WritingExercise } from '@/collection/exercises';

/**
 * The characters of the sentence, one box per cell. `finished` and `written`
 * hold one 0 or 1 per cell, so the grid renders again only when a cell changes state.
 */
export const WritingGrid = memo(function WritingGrid({
	exercise,
	cellSize,
	finished,
	written,
	activeCell,
	sourceCell,
	onReopen
}: {
	exercise: WritingExercise;
	cellSize: number;
	finished: string;
	written: string;
	/** The cell whose popover is open. */
	activeCell: number | null;
	sourceCell: number | null;
	onReopen(cellIndex: number): void;
}) {
	return (
		<div className="writing-grid">
			{exercise.cells.map((cell, index) => {
				const isFinished = finished[index] === '1';
				const isActive = activeCell === index;
				const state = [sourceCell === index && 'source-cell-highlight', isFinished && 'is-complete', isActive && 'is-active'].filter(Boolean).join(' ');
				return (
					<div key={index} data-source-cell={sourceCell === index ? 'true' : undefined} data-complete={isFinished ? 'true' : undefined} className={state || undefined} style={{ width: cellSize }}>
						{written[index] === '1' && !isActive ? (
							<button type="button" aria-label={`${cell.char} 칸의 자모 나누기 고치기`} title="자모 나누기 고치기" onClick={() => onReopen(index)}>
								{cell.char}
							</button>
						) : (
							<span aria-hidden="true">{cell.char}</span>
						)}
					</div>
				);
			})}
		</div>
	);
});
