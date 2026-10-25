import { memo, useState } from 'react';
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records';
import type { CompositionSettings } from '@/font/settings';
import { SourcePopover } from '@/features/preview/source-popover';
import { sourceItems } from '@/features/preview/source-items';
import { useProject } from '@/project/use-project';

/** Syllables that cover every jamo role, so one look at the sheet shows how the composition holds up. */
const SHEET_CHARS = [...'가고구그각곡굵읽닭낡넘괌뭐계줬꽈깲뢒뢥뇲빛뚫쁨앉젊쐈웨흙많힣'];

/** The font on one sheet. Pressing a syllable opens where its handwriting came from, under the sheet. */
export const GlyphSheet = memo(function GlyphSheet({
	drawings,
	sessions,
	settings,
	fontFamily
}: {
	drawings: Record<string, DrawingRecord>;
	sessions: Record<string, WritingSessionRecord>;
	settings: CompositionSettings;
	fontFamily: string;
}) {
	const [picked, setPicked] = useState<string | null>(null);
	const customGlyphs = useProject((state) => state.customGlyphs);

	return (
		<section
			className="glyph-sheet"
			aria-labelledby="glyph-sheet-title"
			onKeyDown={(event) => {
				if (event.key === 'Escape') setPicked(null);
			}}
		>
			<h2 id="glyph-sheet-title" className="text-sm font-semibold">
				글자 모음 한 장
			</h2>
			<div className="glyph-grid">
				{SHEET_CHARS.map((char) => (
					<button key={char} type="button" className="glyph-cell" aria-pressed={picked === char} style={{ fontFamily }} onClick={() => setPicked((previous) => (previous === char ? null : char))}>
						{char}
					</button>
				))}
			</div>
			{picked && (
				<SourcePopover
					items={sourceItems(picked, 0, picked.length, customGlyphs, drawings)}
					hidden={0}
					drawings={drawings}
					sessions={sessions}
					settings={settings}
					fontFamily={fontFamily}
					style={{ top: '100%', left: 0, marginTop: 8, maxWidth: '100%' }}
					onClose={() => setPicked(null)}
				/>
			)}
		</section>
	);
});
