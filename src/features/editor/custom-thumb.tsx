import { memo, useMemo } from 'react';
import { customBounds, type CustomGlyph } from '@/collection/custom-glyphs';
import { strokeSvgPath } from '@/font/stroke/outline';

/** The strokes of a glyph drawn whole, at thumbnail size. An empty box for a glyph not yet written. */
export const CustomThumb = memo(function CustomThumb({ glyph, text, stabilization }: { glyph: CustomGlyph | undefined; text: string; stabilization: number }) {
	const bounds = customBounds(text, glyph?.elements ?? []);
	const paths = useMemo(() => glyph?.elements.filter((stroke) => !stroke.isDeleted).map((stroke) => ({ id: stroke.id, d: strokeSvgPath(stroke, glyph.cellSize, stabilization), x: stroke.x, y: stroke.y })), [glyph, stabilization]);
	return (
		<svg className="custom-thumb" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ aspectRatio: bounds.width / bounds.height }} aria-hidden="true">
			{paths?.map((path) => (
				<path key={path.id} d={path.d} transform={`translate(${path.x} ${path.y})`} fill="#101114" />
			))}
		</svg>
	);
});
