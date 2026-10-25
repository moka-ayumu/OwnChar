// node tools/inspect/diagnose.mjs 계괌꽈  — 글자별 역할 원본 선택(exact/derived/…)과 배치된 박스를 출력한다.
import { hasNonFinite } from '../lib/glyphs.mjs';
import { loadProject } from '../lib/project.mjs';
import { startVite } from '../lib/vite.mjs';

const project = await loadProject();
const chars = [...(process.argv[2] ?? '계괌꽈깲낡뇲뢒뢥')];
const server = await startVite();
try {
	const inputs = await server.ssrLoadModule('/src/generation/inputs.ts');
	const composer = await server.ssrLoadModule('/src/generation/font-builder.ts');
	const hangul = await server.ssrLoadModule('/src/font/layout/compose-syllable.ts');
	const structure = await server.ssrLoadModule('/src/font/hangul.ts');
	const provenance = await server.ssrLoadModule('/src/generation/provenance.ts');
	const settings = project.compositionSettings;
	const generation = inputs.buildGenerationInputs(project.drawings, project.writingSessions ?? {}, settings);
	const request = { ...generation, compositionSettings: settings };
	const prepared = composer.prepareCompositionContext(request);
	const round = (box) => (box ? [box.x1, box.y1, box.x2, box.y2].map((v) => Math.round(v)).join(',') : '-');
	const options = composer.hangulComposeOptions(request, prepared.visualScale);
	for (const char of chars) {
		const codePoint = char.codePointAt(0);
		const sources = provenance.glyphSources(codePoint, project.drawings).map((s) => `${s.role}:${s.char}=${s.match}${s.capture ? `@${s.capture.exerciseId}#${s.capture.cellIndex}` : ''}`);
		const { parts } = hangul.composeHangulParts(codePoint, prepared.shapes, settings, options);
		const box = (path) => (path.commands.length ? path.getBoundingBox() : null);
		console.log(char, 'variants', JSON.stringify(structure.decomposeHangul(codePoint).variants));
		console.log('  sources', sources.join(' | '));
		console.log('  boxes  I', round(box(parts.initial)), ' M', round(box(parts.medial)), ' F', round(box(parts.final)));
		const full = composer.composedHangulPath(codePoint, prepared.shapes, request, prepared.visualScale);
		console.log('  final ', round(box(full)), 'commands', full.commands.length, 'M count', full.commands.filter((c) => c.type === 'M').length);
		const bad = full.commands.findIndex((c) => hasNonFinite([c]));
		if (bad >= 0) console.log('  NaN at command', bad, JSON.stringify(full.commands.slice(Math.max(0, bad - 2), bad + 2)));
		for (const role of ['initial', 'medial', 'final']) {
			const i = parts[role].commands.findIndex((c) => hasNonFinite([c]));
			if (i >= 0) console.log('  NaN in role part', role, i, JSON.stringify(parts[role].commands.slice(Math.max(0, i - 1), i + 2)));
		}
		console.log('  ratios', JSON.stringify(generation.proportions.syllables?.[char] ?? null), 'gap', JSON.stringify(generation.gaps.initialMedialSyllables[char] ?? null));
	}
} finally {
	await server.close();
}
