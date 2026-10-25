// node tools/inspect/guides.mjs 넘호줬 — 해당 글자가 있는 셀의 저장 가이드·쓴 자모 박스를 출력한다.
import { loadProject } from '../lib/project.mjs';
import { startVite } from '../lib/vite.mjs';

const project = await loadProject();
const chars = new Set([...(process.argv[2] ?? '넘호줬')]);
const server = await startVite();
try {
	const { WRITING_EXERCISES, isFixedSlot } = await server.ssrLoadModule('/src/collection/exercises.ts');
	const records = await server.ssrLoadModule('/src/collection/records.ts');
	const inputs = await server.ssrLoadModule('/src/generation/inputs.ts');
	const composer = await server.ssrLoadModule('/src/generation/font-builder.ts');
	const cellGuides = await server.ssrLoadModule('/src/font/guides.ts');
	const settings = project.compositionSettings;
	const generation = inputs.buildGenerationInputs(project.drawings, project.writingSessions ?? {}, settings);
	const request = { ...generation, compositionSettings: settings };
	const prepared = composer.prepareCompositionContext(request);
	const options = composer.hangulComposeOptions(request, prepared.visualScale);
	const r = (n) => Math.round(n);
	const box = (b) => (b ? `[${r(b.x1)},${r(b.y1)} ${r(b.x2)},${r(b.y2)}] ${r(b.x2 - b.x1)}x${r(b.y2 - b.y1)}` : '-');
	for (const exercise of WRITING_EXERCISES) {
		const session = project.writingSessions?.[exercise.id];
		exercise.cells.forEach((cell, index) => {
			if (!chars.has(cell.char)) return;
			const fixed = cell.slots.map((slot, slotIndex) => ({ slot, slotIndex })).filter(({ slot, slotIndex }) => isFixedSlot(slot.promptId, index, slotIndex, exercise, project.drawings) && slot.role);
			if (fixed.length) {
				const guideRoles = Object.fromEntries(fixed.map(({ slot }) => [slot.role, records.guideSourceTag(project.drawings[slot.promptId])]));
				const writtenRoles = cell.slots
					.filter((slot) => {
						const w = project.drawings[slot.promptId]?.capture;
						return slot.role && w?.exerciseId === exercise.id && w.cellIndex === index;
					})
					.map((slot) => slot.role);
				const fresh = cellGuides.composeCellGuide({ codePoint: cell.char.codePointAt(0), cellId: records.cellId(exercise.id, index), guideRoles, writtenRoles: [], stored: undefined, shapes: prepared.shapes, settings, options });
				for (const [role, entry] of Object.entries(fresh.roles)) console.log(`  FRESH guide ${role}: ${box(entry.box)}`);
				for (const [role, b] of Object.entries(fresh.placeholders)) console.log(`  FRESH placeholder ${role}: ${box(b)}`);
			}
			const guide = session?.guides?.[index];
			console.log(`${exercise.id}#${index} ${cell.char}`);
			if (!guide) {
				console.log('  (no stored guide)');
				return;
			}
			for (const [role, entry] of Object.entries(guide.roles)) console.log(`  guide ${role}: ${box(entry.box)}`);
			for (const [role, b] of Object.entries(guide.placeholders)) console.log(`  placeholder ${role}: ${box(b)}`);
			const written = cell.slots.filter((slot) => project.drawings[slot.promptId]?.capture?.exerciseId === exercise.id && project.drawings[slot.promptId].capture.cellIndex === index).map((slot) => slot.role);
			console.log(`  written here: ${written.join(',') || '-'}`);
		});
	}
} finally {
	await server.close();
}
