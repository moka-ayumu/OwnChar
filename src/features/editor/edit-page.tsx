import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import opentype from 'opentype.js';
import { Combine, PenLine, PenTool, Redo2, Save, Type, Undo2 } from 'lucide-react';
import { Hint } from '@/components/hint';
import { RailBrand } from '@/components/rail-brand';
import { Button, buttonVariants } from '@/components/ui/button';
import { HANGUL_ROLES, HANGUL_BASE, isHangulSyllable, type HangulRole } from '@/font/hangul';
import type { Box } from '@/font/geometry/path-ops';
import { composeHangulParts } from '@/font/layout/compose-syllable';
import { mergedOverride } from '@/generation/font-builder';
import { DEFAULT_GLYPH_OVERRIDE } from '@/generation/request';
import { glyphSources } from '@/generation/provenance';
import { compositionShapes } from '@/generation/use-composition-context';
import { SourceChips, pickSources, writeTarget } from '@/features/preview/source-popover';
import { sourceItems } from '@/features/preview/source-items';
import { useCompact } from '@/lib/use-compact';
import { useFontFace } from '@/lib/use-font-face';
import { cn } from '@/lib/utils';
import { projectActions } from '@/project/store';
import { useProject } from '@/project/use-project';
import { CompositionWorkspace } from './composition-workspace';
import { CustomGuide } from './custom-guide';
import { CustomWorkspace } from './custom-glyph-workspace';
import { CODE_POINTS, NO_FILTER, categoryOf, filterHangul, isFiltering, isGlyph, type GlyphCategory } from './glyph-categories';
import { GlyphBrowser } from './glyph-browser';
import { HangulTools, type HangulView } from './glyph-filter';
import { GlyphInspector } from './glyph-inspector';
import { GlyphSpecimen } from './glyph-specimen';

export interface EditSearch {
	/** The glyph to select on arrival. */
	glyph?: number;
	query?: string;
	/** Opens the glyphs drawn whole, with this one selected; empty opens them with none. */
	custom?: string;
}

const COLUMNS = 8;
/** Glyphs per row on a phone, where eight would leave each under 36 px wide. */
const COMPACT_COLUMNS = 6;
const NO_METRICS = { left: 0, right: 0, y: 0 };

type EditorMode = 'glyph' | 'composition' | 'custom';

const MODES = [
	['glyph', '글리프 편집', Type],
	['composition', '한글 조합 설정', Combine],
	['custom', '직접 쓴 글자', PenTool]
] as const;

export function EditPage({ glyph, query, custom }: EditSearch) {
	const navigate = useNavigate();
	const buffer = useProject((state) => state.generatedFont);
	const revision = useProject((state) => state.fontRevision);
	const overrides = useProject((state) => state.glyphOverrides);
	const history = useProject((state) => state.history);
	const globalMetrics = useProject((state) => state.globalMetrics);
	const generatedWith = useProject((state) => state.generatedWith);
	const compositionSettings = useProject((state) => state.compositionSettings);
	const drawings = useProject((state) => state.drawings);
	const sessions = useProject((state) => state.writingSessions);
	const customGlyphs = useProject((state) => state.customGlyphs);
	const fontReady = useFontFace(buffer, revision);
	const initial = glyph !== undefined && isGlyph(glyph) ? glyph : HANGUL_BASE;
	const [search, setSearch] = useState(query ?? '');
	const [selected, setSelected] = useState<number[]>([initial]);
	const [category, setCategory] = useState<GlyphCategory>(() => categoryOf(initial) ?? 'hangul');
	const [hangulView, setHangulView] = useState<HangulView>('filter');
	const [filter, setFilter] = useState(NO_FILTER);
	const [editorMode, setEditorMode] = useState<EditorMode>(custom !== undefined ? 'custom' : 'glyph');
	const [guideOpen, setGuideOpen] = useState(false);
	const columns = useCompact() ? COMPACT_COLUMNS : COLUMNS;

	useEffect(() => {
		if (!buffer) void navigate({ to: '/write' });
	}, [buffer, navigate]);

	const [seenCustom, setSeenCustom] = useState(custom);
	if (custom !== seenCustom) {
		setSeenCustom(custom);
		if (custom !== undefined) setEditorMode('custom');
	}

	const font = useMemo(() => (buffer ? opentype.parse(buffer.slice(0)) : null), [buffer]);

	const visible = useMemo(() => {
		const codePoint = [...search][0]?.codePointAt(0);
		if (codePoint !== undefined) return isGlyph(codePoint) ? [codePoint] : [];
		return category === 'hangul' && hangulView === 'filter' && isFiltering(filter) ? filterHangul(filter) : CODE_POINTS[category];
	}, [search, category, hangulView, filter]);

	const single = selected.length === 1 ? selected[0] : null;
	const sources = useMemo(() => {
		if (single === null) return [];
		const char = String.fromCodePoint(single);
		return sourceItems(char, 0, char.length, customGlyphs, drawings);
	}, [single, customGlyphs, drawings]);
	const shapes = useMemo(() => compositionShapes(drawings, sessions, compositionSettings), [drawings, sessions, compositionSettings]);
	const glyphParts = useMemo(() => (single === null || sources[0]?.custom ? [] : glyphSources(single, drawings, shapes)), [single, sources, drawings, shapes]);
	const partCounts = useMemo(() => {
		const counts: Partial<Record<HangulRole, number>> = {};
		for (const part of glyphParts) if (part.role && part.match === 'compound') counts[part.role] = (counts[part.role] ?? 0) + 1;
		return counts;
	}, [glyphParts]);
	const roleBoxes = useMemo(() => {
		if (single === null || !isHangulSyllable(single)) return undefined;
		const { parts } = composeHangulParts(single, shapes, compositionSettings);
		const boxes: Partial<Record<HangulRole, Box>> = {};
		for (const role of HANGUL_ROLES) if (parts[role].commands.length) boxes[role] = parts[role].getBoundingBox();
		return boxes;
	}, [single, shapes, compositionSettings]);
	const overrideCount = Object.keys(overrides).length;
	const previewFont = fontReady ? 'OwnCharPreview' : 'inherit';
	const madeSource = useMemo(() => ({ overrides: generatedWith?.glyphOverrides ?? {}, globalMetrics: generatedWith?.globalMetrics ?? NO_METRICS }), [generatedWith]);

	/** Scales every selected glyph to the height of the tallest one. */
	const fitHeight = () => {
		if (!font || selected.length < 2) return;
		const heights = selected.map((codePoint) => {
			const box = font.charToGlyph(String.fromCodePoint(codePoint)).getBoundingBox();
			return Math.max(1, box.y2 - box.y1);
		});
		const max = Math.max(...heights);
		selected.forEach((codePoint, index) => projectActions.applyGlyphTransform([codePoint], { scale: (mergedOverride(madeSource, codePoint).scale * max) / heights[index] }));
	};

	if (!buffer || !font) return null;

	const writeReturn = single === null ? undefined : { returnGlyph: single, returnQuery: search || undefined };
	const openSource = (keys: string[]) => {
		const custom = sources[0]?.custom;
		if (custom) return void navigate({ to: '/edit', search: { custom: custom.text } });
		const target = pickSources(glyphParts, keys)
			.map((part) => writeTarget(part, drawings))
			.find(Boolean);
		if (target) void navigate({ to: '/write', search: { ...target, ...writeReturn } });
	};

	return (
		<div className="flow edit-flow">
			<aside className="rail">
				<RailBrand />
				<h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">고급 편집</h1>
				<div className="rail-figure mt-5">
					{overrideCount.toLocaleString()}
					<small>개 수정됨</small>
				</div>

				<div className="rail-modes" role="group" aria-label="편집 방식">
					{MODES.map(([mode, label, Icon]) => (
						<button key={mode} type="button" aria-pressed={editorMode === mode} onClick={() => setEditorMode(mode)}>
							<Icon className="size-4" aria-hidden="true" />
							{label}
						</button>
					))}
				</div>

				<div className="mt-3 flex gap-1">
					<Button size="icon" variant="ghost" aria-label="실행 취소" disabled={!history.past.length} onClick={projectActions.undo}>
						<Undo2 className="size-4" />
					</Button>
					<Button size="icon" variant="ghost" aria-label="다시 실행" disabled={!history.future.length} onClick={projectActions.redo}>
						<Redo2 className="size-4" />
					</Button>
				</div>

				<div className="mt-auto grid gap-2 pt-6">
					<Hint className="block" side="right" label={editorMode === 'composition' ? '예시는 즉시 바뀌고, OTF는 변경 적용 후 바뀝니다.' : editorMode === 'custom' ? '직접 쓴 글자는 변경 적용 후 OTF에 반영됩니다.' : undefined}>
						<Button className="w-full" size="lg" onClick={() => void navigate({ to: '/generate', viewTransition: true })}>
							<Save className="size-4" /> 변경 적용
						</Button>
					</Hint>
					<div className="grid grid-cols-2 gap-2">
						<Link to="/write" className={cn(buttonVariants({ variant: 'secondary' }), 'px-2')}>
							<PenLine className="size-4" /> 글자 다시 쓰기
						</Link>
						<Link to="/preview" viewTransition className={cn(buttonVariants({ variant: 'secondary' }), 'px-2')}>
							미리보기
						</Link>
					</div>
				</div>
			</aside>

			<section className="stage">
				{editorMode === 'glyph' ? (
					<div className="edit-stage">
						<GlyphBrowser
							category={category}
							onCategory={setCategory}
							search={search}
							onSearch={setSearch}
							tools={category === 'hangul' && <HangulTools view={hangulView} onView={setHangulView} filter={filter} onFilter={setFilter} count={visible.length} onSelectAll={() => setSelected(visible)} />}
							visible={visible}
							selected={selected}
							onSelect={setSelected}
							overrides={overrides}
							fontFamily={previewFont}
							columns={columns}
						/>
						<div className="edit-specimen">
							{single !== null ? (
								<GlyphSpecimen
									font={font}
									codePoint={single}
									specific={overrides[single] ?? DEFAULT_GLYPH_OVERRIDE}
									globalMetrics={globalMetrics}
									made={mergedOverride(madeSource, single)}
									proportional={compositionSettings.widthMode === 'proportional'}
									roleBoxes={roleBoxes}
									partCounts={partCounts}
									renderSource={(keys) => sources.length > 0 && <SourceChips item={sources[0]} keys={keys} drawings={drawings} sessions={sessions} settings={compositionSettings} className="grid gap-1.5" />}
									onOpenSource={openSource}
									onCommit={(patch) => projectActions.applyGlyphTransform([single], patch)}
								/>
							) : (
								<div className="specimen specimen-count">
									<span className="tnum">{selected.length.toLocaleString()}자 선택</span>
								</div>
							)}
						</div>
						<GlyphInspector
							selected={selected}
							overrides={overrides}
							globalMetrics={globalMetrics}
							source={
								sources.length > 0 ? (
									<SourceChips item={sources[0]} drawings={drawings} sessions={sessions} settings={compositionSettings} writeReturn={writeReturn} className="grid gap-2" />
								) : (
									<p className="text-xs text-ink-2">원본 없음</p>
								)
							}
							onFitHeight={fitHeight}
						/>
					</div>
				) : editorMode === 'composition' ? (
					<CompositionWorkspace drawings={drawings} sessions={sessions} settings={compositionSettings} />
				) : (
					<CustomWorkspace customGlyphs={customGlyphs} fontFamily={previewFont} stabilization={compositionSettings.endpointStabilization} initialText={custom} onOpenGuide={() => setGuideOpen(true)} />
				)}
			</section>
			<CustomGuide
				open={guideOpen}
				fontFamily={previewFont}
				onOpenChange={setGuideOpen}
				onPick={(text) => {
					setEditorMode('custom');
					void navigate({ to: '/edit', search: { custom: text }, replace: true });
				}}
			/>
		</div>
	);
}
