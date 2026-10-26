import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { Type } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useOpenEdit } from '@/features/editor/use-open-edit';
import { cn } from '@/lib/utils';

/** Syllables that cover every jamo role, so one look at the sheet shows how the composition holds up. */
const SHEET_CHARS = [...'가고구그각곡굵읽닭낡넘괌뭐계줬꽈깲뢒뢥뇲빛뚫쁨앉젊쐈웨흙많힣'];

/** The font on one sheet. Pressing a syllable opens it in the glyph editor. */
export const GlyphSheet = memo(function GlyphSheet({ fontFamily }: { fontFamily: string }) {
	const openEdit = useOpenEdit();

	return (
		<section className="glyph-sheet" aria-labelledby="glyph-sheet-title">
			<h2 id="glyph-sheet-title" className="text-sm font-semibold">
				글자 모음
			</h2>
			<div className="glyph-grid">
				{SHEET_CHARS.map((char) => (
					<button key={char} type="button" className="glyph-cell" style={{ fontFamily }} onClick={() => openEdit({ glyph: char.codePointAt(0) })}>
						{char}
					</button>
				))}
			</div>
			<Link to="/edit" viewTransition className={cn(buttonVariants({ variant: 'secondary' }), 'mt-3 w-full')}>
				<Type className="size-4" /> 다른 글자 편집
			</Link>
		</section>
	);
});
