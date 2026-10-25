/// <reference lib="webworker" />

import { HANGUL_COUNT, INITIALS } from '@/font/hangul';
import { composeFont, prepareCompositionContext, type PreparedCompositionContext } from './font-builder';
import type { ChunkEvent, ChunkRequest } from './font-chunk.worker';
import type { EncodedGlyphs } from './otf-writer';
import type { FontWorkerRequest, GenerationEvent, GenerationRequest } from './request';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const post = (event: GenerationEvent, transfer: Transferable[] = []) => worker.postMessage(event, transfer);
let cancelled = false;
let children: Worker[] = [];

function stopChildren() {
	children.forEach((child) => child.terminate());
	children = [];
}

/** Composes the syllables on up to eight child workers, split by initial consonant. Undefined on a single core. */
async function parallelHangul(request: GenerationRequest, prepared: PreparedCompositionContext) {
	const available = typeof navigator === 'undefined' ? 1 : (navigator.hardwareConcurrency ?? 4);
	const count = Math.min(8, Math.max(1, available - 1));
	if (count === 1) return undefined;
	const completed = new Array<number>(count).fill(0);
	const bounds = Array.from({ length: count + 1 }, (_, id) => Math.floor((INITIALS.length * id) / count) * 588);
	const results = await Promise.all(
		Array.from(
			{ length: count },
			(_, id) =>
				new Promise<EncodedGlyphs>((resolve, reject) => {
					const chunk: ChunkRequest = { request, prepared, start: bounds[id], end: bounds[id + 1] };
					const child = new Worker(new URL('./font-chunk.worker.ts', import.meta.url), { type: 'module' });
					children.push(child);
					child.onmessage = ({ data }: MessageEvent<ChunkEvent>) => {
						if (data.type === 'progress') {
							completed[id] = data.completed;
							const done = completed.reduce((sum, value) => sum + value, 0);
							post({
								type: 'progress',
								stage: 'hangul',
								progress: 3 + Math.round((done / HANGUL_COUNT) * 91),
								message: `${done.toLocaleString()} / ${HANGUL_COUNT.toLocaleString()} 글자 조합 중`,
								lanes: completed.map((value, lane) => value / (bounds[lane + 1] - bounds[lane]))
							});
						} else if (data.type === 'complete') {
							child.terminate();
							resolve(data.glyphs);
						} else {
							child.terminate();
							reject(new Error(data.message));
						}
					};
					child.onerror = (error) => {
						child.terminate();
						reject(new Error(error.message));
					};
					child.postMessage(chunk);
				})
		)
	);
	children = [];
	return results;
}

worker.onmessage = async (event: MessageEvent<FontWorkerRequest>) => {
	if (event.data.type === 'cancel') {
		cancelled = true;
		stopChildren();
		return;
	}

	cancelled = false;
	try {
		const preparedContext = prepareCompositionContext(event.data);
		let encodedHangul: EncodedGlyphs[] | undefined;
		try {
			encodedHangul = await parallelHangul(event.data, preparedContext);
		} catch {
			// Without child workers the syllables are composed here instead.
			stopChildren();
		}
		if (cancelled) throw new DOMException('Generation cancelled', 'AbortError');
		const result = await composeFont(event.data, {
			cancelled: () => cancelled,
			progress: (stage, progress, message) => post({ type: 'progress', stage, progress, message }),
			yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
			encodedHangul,
			preparedContext
		});
		if (cancelled) post({ type: 'cancelled' });
		else post({ type: 'complete', buffer: result.buffer, glyphCount: result.glyphCount }, [result.buffer]);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') post({ type: 'cancelled' });
		else post({ type: 'error', message: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' });
	}
};
