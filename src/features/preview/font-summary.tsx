import { memo, useEffect, useState } from 'react';
import type { DrawingRecord, WritingSessionRecord } from '@/collection/records';
import type { CompositionSettings } from '@/font/settings';
import { glyphCoverage, type GlyphCoverage } from '@/generation/provenance';
import { compositionShapes } from '@/generation/use-composition-context';
import { Hint } from '@/components/hint';
import { cancelIdle, whenIdle } from '@/lib/idle';

const ROWS = [
	{ key: 'exact', label: '쓴 그대로', note: '그 자리에 쓴 자모로 생성', swatch: 'bg-ink' },
	{ key: 'adapted', label: '다른 자리에서 맞춤', note: '같은 자모를 다른 자리에서 가져옴', swatch: 'bg-ink-3' },
	{ key: 'missing', label: '만들지 못함', note: '쓰지 않은 자모가 있어 비어 있음', swatch: 'bg-danger' }
] as const;

const format = (value: number) => value.toLocaleString('ko-KR');

/** What the 11,172 syllables stand on: the part of the font that is the handwriting itself, and the part that is fitted from it. */
export const FontSummary = memo(function FontSummary({ drawings, sessions, settings, size }: { drawings: Record<string, DrawingRecord>; sessions: Record<string, WritingSessionRecord>; settings: CompositionSettings; size: string }) {
	const [coverage, setCoverage] = useState<GlyphCoverage | null>(null);

	useEffect(() => {
		const handle = whenIdle(() => setCoverage(glyphCoverage(drawings, compositionShapes(drawings, sessions, settings))));
		return () => cancelIdle(handle);
	}, [drawings, sessions, settings]);

	const rows = ROWS.filter((row) => row.key !== 'missing' || (coverage?.missing ?? 0) > 0);

	return (
		<section className="font-summary" aria-labelledby="font-summary-title">
			<h2 id="font-summary-title" className="text-sm font-semibold">
				한글 11,172자 구성
			</h2>
			<div className="coverage-bar" aria-hidden="true">
				{coverage && ROWS.map((row) => coverage[row.key] > 0 && <span key={row.key} className={row.swatch} style={{ flexGrow: coverage[row.key] }} />)}
			</div>
			<dl className="coverage-list">
				{rows.map((row) => (
					<div key={row.key}>
						<Hint className="coverage-row" side="top" label={row.note}>
							<span className={`coverage-swatch ${row.swatch}`} aria-hidden="true" />
							<dt>{row.label}</dt>
							<dd className="tnum">{coverage ? `${format(coverage[row.key])}자` : '…'}</dd>
						</Hint>
					</div>
				))}
			</dl>
			<p className="text-xs text-ink-3">OTF 파일 크기 {size}</p>
		</section>
	);
});
