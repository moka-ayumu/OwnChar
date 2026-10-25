import { memo } from 'react';
import { ArrowLeft, ArrowRight, Type } from 'lucide-react';
import { exerciseCompletion, WRITING_EXERCISES, type GuideMode } from '@/collection/exercises';
import { completedPromptCount, PROMPT_COUNT } from '@/collection/prompts';
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records';
import { Hint } from '@/components/hint';
import { ProgressRing } from '@/components/progress-ring';
import { RailBrand } from '@/components/rail-brand';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

/**
 * The side rail of the write page: collection progress, the sentence list and the way on.
 * Closing it only narrows it: every row keeps its place and its leading icon, and the text beside it is cut off.
 */
export const WriteRail = memo(function WriteRail({
	drawings,
	sessions,
	guideMode,
	currentIndex,
	collapsed,
	hasGeneratedFont,
	onToggle,
	onGo,
	onRequestGeneration,
	onOpenExistingFont
}: {
	drawings: Record<string, DrawingRecord>;
	sessions: Record<string, WritingSessionRecord>;
	guideMode: GuideMode;
	currentIndex: number;
	collapsed: boolean;
	hasGeneratedFont: boolean;
	onToggle(): void;
	onGo(index: number): void;
	onRequestGeneration(): void;
	onOpenExistingFont(): void;
}) {
	const completed = completedPromptCount(drawings);
	const isLast = currentIndex === WRITING_EXERCISES.length - 1;
	return (
		<aside className="rail write-rail">
			<RailBrand collapsed={collapsed} onToggle={onToggle} />
			<div className="write-sidebar-overview">
				<Hint className="relative block" label={collapsed && `전체 수집률 ${completed} / ${PROMPT_COUNT}`}>
					<span className="rail-label rail-text">전체 수집률</span>
					<div className="rail-figure rail-text mt-1">
						{completed}
						<small>/ {PROMPT_COUNT}</small>
					</div>
					<Progress className="rail-text mt-3" value={(completed / PROMPT_COUNT) * 100} />
					{/* Closed, the same progress stands upright in the space the figure leaves. */}
					<span className="rail-total-upright" aria-hidden="true">
						<i style={{ height: `${(completed / PROMPT_COUNT) * 100}%` }} />
					</span>
				</Hint>
				<div className="write-character-section">
					<div className="rail-text mb-2 flex items-center justify-between">
						<span className="rail-label">연습 문장</span>
						<span className="tnum text-xs font-semibold">
							{currentIndex + 1} / {WRITING_EXERCISES.length}
						</span>
					</div>
					<div className="exercise-list" aria-label="문장 진행 상황">
						{WRITING_EXERCISES.map((item, index) => {
							const progress = exerciseCompletion(item, drawings, sessions[item.id], guideMode);
							const count = `${progress.completed} / ${progress.total} 자모`;
							return (
								<Hint key={item.id} className="block" label={collapsed ? `${item.title} · ${count}` : count}>
									<button onClick={() => onGo(index)} aria-label={`${item.title}, ${count}`} aria-current={index === currentIndex ? 'step' : undefined} className={`exercise-chip ${index === currentIndex ? 'current' : ''}`}>
										<span className="exercise-chip-state">
											<ProgressRing value={progress.completed} total={progress.total} />
										</span>
										<strong>{item.title}</strong>
									</button>
								</Hint>
							);
						})}
					</div>
				</div>
			</div>
			<div className="write-actions">
				<Button size="icon" variant="secondary" aria-label="이전 문장" title="이전 문장" disabled={currentIndex === 0} onClick={() => onGo(currentIndex - 1)}>
					<ArrowLeft className="size-4" />
				</Button>
				{isLast ? (
					<Button aria-label="폰트 만들기" title={collapsed ? '폰트 만들기' : undefined} onClick={onRequestGeneration}>
						{collapsed ? <Type className="size-4" /> : '폰트 만들기'}
					</Button>
				) : (
					<Button aria-label="다음 문장" title={collapsed ? '다음 문장' : undefined} onClick={() => onGo(currentIndex + 1)}>
						{!collapsed && '다음 문장'}
						<ArrowRight className="size-4" />
					</Button>
				)}
			</div>
			{!collapsed && !isLast && (
				<Button className="mt-2 w-full" variant="ghost" onClick={onRequestGeneration}>
					지금 폰트 만들기
				</Button>
			)}
			{!collapsed && hasGeneratedFont && (
				<Button className="mt-2 w-full px-2" variant="secondary" onClick={onOpenExistingFont}>
					기존 폰트 미리보기 · 편집
				</Button>
			)}
		</aside>
	);
});
