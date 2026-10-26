import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Download, PenLine, RefreshCw, Settings2 } from 'lucide-react';
import { RailBrand } from '@/components/rail-brand';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { CustomGuide } from '@/features/editor/custom-guide';
import { CustomIntro } from '@/features/preview/custom-intro';
import { DialPanel } from '@/features/preview/dial-panel';
import { SourcePopover } from '@/features/preview/source-popover';
import { sourceItems } from '@/features/preview/source-items';
import { isHangulSyllable } from '@/font/hangul';
import { useLiveFont } from '@/generation/use-live-font';
import { useOpenEdit } from '@/features/editor/use-open-edit';
import { FontSummary } from '@/features/preview/font-summary';
import { GlyphSheet } from '@/features/preview/glyph-sheet';
import { LEAD_SENTENCE, LEAD_SIZE, SAMPLE_SENTENCES } from '@/lib/flow';
import { useFontFace } from '@/lib/use-font-face';
import { useStableCallback } from '@/lib/use-stable-callback';
import { useProject } from '@/project/use-project';
import { cn, downloadArrayBuffer, safeFilename } from '@/lib/utils';
import { projectActions } from '@/project/store';

export const Route = createFileRoute('/preview')({ component: PreviewPage });

/** Most characters whose sources the popover lists. */
const SOURCE_LIMIT = 4;
/** Widest the popover is; a wider one is not kept inside the stage when the selection is at the right. */
const POPOVER_WIDTH = 540;

/** Sizes the sentence is also set at, from running text to a headline. */
const LADDER_SIZES = [16, 24, 40];

interface Picked {
	start: number;
	end: number;
}

/** The first two syllables of `text`: selected on arrival, so the writer finds out that a selection shows its sources. */
function leadingSyllables(text: string): Picked | null {
	const start = text.search(/[가-힣]/);
	if (start < 0) return null;
	return { start, end: start + (isHangulSyllable(text.codePointAt(start + 1) ?? 0) ? 2 : 1) };
}

function PreviewPage() {
	const navigate = useNavigate();
	const openEdit = useOpenEdit();
	const buffer = useProject((state) => state.generatedFont);
	const revision = useProject((state) => state.fontRevision);
	const metadata = useProject((state) => state.metadata);
	const dirty = useProject((state) => state.fontDirty);
	const drawings = useProject((state) => state.drawings);
	const sessions = useProject((state) => state.writingSessions);
	const settings = useProject((state) => state.compositionSettings);
	const overrides = useProject((state) => state.glyphOverrides);
	const globalMetrics = useProject((state) => state.globalMetrics);
	const customGlyphs = useProject((state) => state.customGlyphs);
	const fontReady = useFontFace(buffer, revision);
	const [askApply, setAskApply] = useState(false);
	const [guideOpen, setGuideOpen] = useState(false);
	const [sample, setSample] = useState(LEAD_SENTENCE);
	// Generation ends on the first sample at this size, standing exactly where it is shown here.
	const [fontSize, setFontSize] = useState(LEAD_SIZE);
	const [picked, setPicked] = useState<Picked | null>(() => leadingSyllables(LEAD_SENTENCE));
	const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
	const liveFamily = useLiveFont(sample, settings, { drawings, sessions, overrides, globalMetrics, customGlyphs });
	const stack = useRef<HTMLDivElement>(null);
	const mark = useRef<HTMLElement>(null);

	useEffect(() => {
		if (!buffer) void navigate({ to: '/write' });
	}, [buffer, navigate]);

	const closePopover = useStableCallback(() => {
		// The popover is going; a focus left inside it would be nowhere.
		if (stack.current?.querySelector('.source-popover')?.contains(document.activeElement)) document.getElementById('sample')?.focus();
		setPicked(null);
	});

	useEffect(() => {
		if (!picked) return;
		const close = (event: KeyboardEvent) => {
			if (event.key === 'Escape') closePopover();
		};
		window.addEventListener('keydown', close);
		return () => window.removeEventListener('keydown', close);
	}, [picked, closePopover]);

	useEffect(() => {
		const follow = () => {
			const area = document.getElementById('sample');
			if (!(area instanceof HTMLTextAreaElement) || document.activeElement !== area) return;
			const { selectionStart: start, selectionEnd: end } = area;
			setPicked((previous) => (start === end ? null : previous?.start === start && previous.end === end ? previous : { start, end }));
		};
		document.addEventListener('selectionchange', follow);
		return () => document.removeEventListener('selectionchange', follow);
	}, []);

	useEffect(() => {
		if (!picked) return;
		const release = (event: PointerEvent) => {
			if (!stack.current?.contains(event.target as Node)) setPicked(null);
		};
		document.addEventListener('pointerdown', release, true);
		return () => document.removeEventListener('pointerdown', release, true);
	}, [picked]);

	useLayoutEffect(() => {
		const place = () => {
			const first = mark.current?.getClientRects()[0];
			const frame = stack.current?.getBoundingClientRect();
			if (!first || !frame) {
				setAnchor(null);
				return;
			}
			const width = Math.min(POPOVER_WIDTH, frame.width);
			const next = { left: Math.max(0, Math.min(first.left - frame.left, frame.width - width)), top: first.bottom - frame.top + 8, width };
			setAnchor((previous) => (previous && previous.left === next.left && previous.top === next.top && previous.width === next.width ? previous : next));
		};
		place();
		// A resize fires faster than frames; the popover is placed once per frame.
		let frame = 0;
		const schedule = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				place();
			});
		};
		window.addEventListener('resize', schedule);
		return () => {
			window.removeEventListener('resize', schedule);
			cancelAnimationFrame(frame);
		};
	}, [picked, sample, fontSize, liveFamily, fontReady]);

	if (!buffer) return null;
	// A syllable the live font does not hold yet is drawn from the generated font until it arrives.
	const fontFamily = [liveFamily, fontReady && 'OwnCharPreview'].filter(Boolean).join(', ') || 'inherit';
	const textStyle = { fontFamily, fontSize, lineHeight: 1.25 };
	const selected = picked ? sourceItems(sample, picked.start, picked.end, customGlyphs, drawings) : [];
	const download = () => downloadArrayBuffer(buffer, `${safeFilename(metadata.familyName)}.otf`);
	const readSelection = ({ currentTarget }: SyntheticEvent<HTMLTextAreaElement>) => {
		const { selectionStart: start, selectionEnd: end } = currentTarget;
		setPicked((previous) => (start === end ? null : previous?.start === start && previous.end === end ? previous : { start, end }));
	};

	return (
		<div className="flow preview-flow">
			<aside className="rail">
				<RailBrand />
				<h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">폰트 생성이 완료되었습니다.</h1>

				<div className="mt-6 space-y-4">
					<div>
						<label className="input-label" htmlFor="familyName">
							폰트 이름
						</label>
						<input id="familyName" className="text-input mt-1.5" value={metadata.familyName} onChange={(event) => projectActions.updateFontMetadata({ familyName: event.target.value })} />
					</div>
					<div>
						<label className="input-label" htmlFor="designer">
							제작자
						</label>
						<input id="designer" className="text-input mt-1.5" value={metadata.designer} placeholder="이름을 입력하세요" onChange={(event) => projectActions.updateFontMetadata({ designer: event.target.value })} />
					</div>
					<div>
						<label className="input-label" htmlFor="version">
							버전
						</label>
						<input id="version" className="text-input mt-1.5" value={metadata.version} onChange={(event) => projectActions.updateFontMetadata({ version: event.target.value })} />
					</div>
				</div>

				<div className="mt-auto grid gap-2 pt-6">
					{dirty && (
						<div className="rail-change" role="status">
							<span>설정이 변경되어 재생성이 필요합니다.</span>
							<Button variant="secondary" className="w-full" onClick={() => void navigate({ to: '/generate', viewTransition: true })}>
								<RefreshCw className="size-3.5" /> 변경 적용
							</Button>
						</div>
					)}
					<Button size="lg" onClick={() => (dirty ? setAskApply(true) : download())}>
						<Download className="size-4" /> OTF 다운로드
					</Button>
					<div className="grid grid-cols-2 gap-2">
						<Link to="/write" viewTransition className={cn(buttonVariants({ variant: 'secondary' }), 'px-2')}>
							<PenLine className="size-4" /> 글자 다시 쓰기
						</Link>
						<Link to="/edit" viewTransition className={cn(buttonVariants({ variant: 'secondary' }), 'px-2')}>
							<Settings2 className="size-4" /> 고급 편집
						</Link>
					</div>
				</div>
			</aside>

			<Dialog open={askApply} onOpenChange={setAskApply}>
				<DialogContent>
					<DialogTitle>변경 사항을 적용하시겠습니까?</DialogTitle>
					<DialogDescription>적용하지 않으면 현재 OTF에 변경 내용이 반영되지 않습니다.</DialogDescription>
					<div className="mt-6 flex justify-end gap-2">
						<Button
							variant="secondary"
							onClick={() => {
								setAskApply(false);
								download();
							}}
						>
							아니요
						</Button>
						<Button onClick={() => void navigate({ to: '/generate', viewTransition: true })}>네</Button>
					</div>
				</DialogContent>
			</Dialog>

			<CustomGuide open={guideOpen} fontFamily={fontReady ? 'OwnCharPreview' : 'inherit'} onOpenChange={setGuideOpen} onPick={(text) => openEdit({ custom: text })} />

			<section className="stage">
				<div className="preview-stage">
					<label htmlFor="sample" className="sr-only">
						직접 입력
					</label>

					<div className="preview-grid">
						<div className="preview-main">
							<div className="sample-bar">
								<div className="sample-chips" role="group" aria-label="예시 문장">
									{SAMPLE_SENTENCES.map((item) => (
										<button
											key={item.label}
											type="button"
											className="sample-chip"
											aria-pressed={sample === item.text}
											onClick={() => {
												setSample(item.text);
												setPicked(leadingSyllables(item.text));
											}}
										>
											{item.label}
										</button>
									))}
								</div>
								<div className="preview-size flex w-64 items-center gap-3">
									<label htmlFor="preview-size" className="shrink-0 text-xs font-semibold text-ink-2">
										글자 크기
									</label>
									<Slider id="preview-size" aria-label="미리보기 글자 크기" min={36} max={160} step={2} value={[fontSize]} onValueChange={([value]) => setFontSize(value)} />
									<span className="tnum w-11 text-right text-xs font-semibold">{fontSize}px</span>
								</div>
							</div>

							<div ref={stack} className="type-stack">
								{/* The text again, unseen, under the text area: it marks the picked characters and says where they stand. */}
								<div className="font-preview type-overlay type-picked" style={textStyle} aria-hidden="true">
									{picked ? (
										<>
											{sample.slice(0, picked.start)}
											<mark ref={mark}>{sample.slice(picked.start, picked.end)}</mark>
											{sample.slice(picked.end)}
										</>
									) : (
										sample
									)}
									{'\n'}
								</div>
								<textarea
									id="sample"
									value={sample}
									onChange={(event) => {
										setSample(event.target.value);
										setPicked(null);
									}}
									onSelect={readSelection}
									onKeyUp={readSelection}
									onClick={readSelection}
									className="font-preview min-h-64 w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-ink-3"
									style={textStyle}
								/>
								{anchor && selected.length > 0 && (
									<SourcePopover
										items={selected.slice(0, SOURCE_LIMIT)}
										hidden={Math.max(0, selected.length - SOURCE_LIMIT)}
										drawings={drawings}
										sessions={sessions}
										settings={settings}
										fontFamily={fontFamily}
										style={{ left: anchor.left, top: anchor.top, maxWidth: anchor.width }}
										onClose={closePopover}
									/>
								)}
							</div>

							{!Object.keys(customGlyphs).length && <CustomIntro fontFamily={fontFamily} onGuide={() => setGuideOpen(true)} onTry={() => openEdit({ custom: '' })} />}

							<DialPanel settings={settings} />

							<section className="size-ladder" aria-labelledby="size-ladder-title">
								<h2 id="size-ladder-title" className="text-sm font-semibold">
									크기별로 보기
								</h2>
								{LADDER_SIZES.map((size) => (
									<div key={size} className="size-ladder-row">
										<span className="tnum">{size}px</span>
										<span style={{ fontFamily, fontSize: size }}>{sample.replace(/\s+/g, ' ').trim() || ' '}</span>
									</div>
								))}
							</section>
						</div>

						<aside className="preview-side" aria-label="폰트 살펴보기">
							<GlyphSheet fontFamily={fontFamily} />
							<FontSummary drawings={drawings} sessions={sessions} settings={settings} />
						</aside>
					</div>
				</div>
			</section>
		</div>
	);
}
