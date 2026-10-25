// node tools/sample/home-film.mjs [--out=src/features/samples/home-film.json]
// Reads the example handwriting, composes syllables with the app's own composer,
// and writes what the home film draws: the strokes of the written cells, the syllables
// those cells compose alone, and the glyphs of each closing sentence.
import { readFileSync, writeFileSync } from 'node:fs';
import { startVite } from '../lib/vite.mjs';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = arg('out', 'src/features/samples/home-film.json');
const SOURCE = 'src/features/samples/example.json';
const EXERCISE = 'hangul-sentence-0';
/** The cells the film writes: the start of the first sentence. */
const WRITTEN = '흐린 퇴근길 휴대폰에';
/** Syllables that were not written, composed from the jamo of the written cells alone. */
const COMPOSED = arg('composed', '글돌흔');
/** The sentences the film ends on, one per loop. They continue the story of the collection sentences. */
const CLOSING = ['친구는 노란 꽃을 내 손에 쥐여 주었다', '우리는 벤치에 앉아 한참을 웃었다', '돌아오는 길에 또 보자고 문자를 보냈다'];
/** How many more syllables the film composes after those of `COMPOSED`. */
const STREAM = 54;
const SIDE_BEARING = 55;
const SPACE_ADVANCE = 400;

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const roundPath = (d) => d.replace(/-?\d+\.\d+/g, (number) => String(round(Number(number))));

const server = await startVite();
try {
	const { WRITING_EXERCISES } = await server.ssrLoadModule('/src/collection/exercises.ts');
	const { cellOrigin } = await server.ssrLoadModule('/src/collection/records.ts');
	const { assignStrokes, captureRecords } = await server.ssrLoadModule('/src/features/writing/stroke-assignment.ts');
	const { projectStore, projectActions } = await server.ssrLoadModule('/src/project/store.ts');
	const { decomposeHangul, isHangulSyllable, syllableRoles } = await server.ssrLoadModule('/src/font/hangul.ts');
	const { prepareCffPath } = await server.ssrLoadModule('/src/font/geometry/cff.ts');
	const { svgPathData } = await server.ssrLoadModule('/src/font/geometry/svg.ts');
	const { visualCalibrationScale } = await server.ssrLoadModule('/src/font/glyphs/calibration.ts');
	const { selectJamoSource, sourceKey } = await server.ssrLoadModule('/src/font/layout/source-selection.ts');
	const { penDiameter, strokeSvgPath } = await server.ssrLoadModule('/src/font/stroke/outline.ts');
	const { stabilizeStroke } = await server.ssrLoadModule('/src/font/stroke/stabilizer.ts');
	const builder = await server.ssrLoadModule('/src/generation/font-builder.ts');
	const inputs = await server.ssrLoadModule('/src/generation/inputs.ts');

	const source = JSON.parse(readFileSync(SOURCE, 'utf8')).sessions;
	const exercise = WRITING_EXERCISES.find((item) => item.id === EXERCISE);
	if (!exercise.text.startsWith(WRITTEN)) throw new Error(`"${WRITTEN}" is not the start of ${EXERCISE}`);
	const count = [...WRITTEN].length;

	/** Fills the project through the path the home page's example button takes, and returns what the composer needs. */
	const load = (sessions) => {
		projectActions.startProject();
		for (const { exerciseId, cellSize, columns, elements, boundaries } of sessions) {
			const item = WRITING_EXERCISES.find((candidate) => candidate.id === exerciseId);
			const state = projectStore.state;
			const grid = { cellSize, columns };
			const assigned = assignStrokes(elements, grid, item, state.drawings, boundaries, { mode: state.guideMode, pinned: {} });
			const guides = {};
			for (const { cellIndex } of assigned.assignments) guides[cellIndex] = { roles: {}, placeholders: {}, bands: {} };
			projectActions.saveSentenceCapture(
				{
					exerciseId,
					text: item.text,
					elements,
					assignments: assigned.assignments,
					boundaries: assigned.boundaries,
					cellSize,
					columns,
					updatedAt: 0,
					guides
				},
				captureRecords(assigned.groups, grid, exerciseId, state.compositionSettings.endpointStabilization)
			);
		}
		const state = projectStore.state;
		const settings = state.compositionSettings;
		const shapes = inputs.shapesFromRequestDrawings(inputs.toRequestDrawings(state.drawings, state.writingSessions), settings);
		const profile = inputs.learnCompositionProfile(state.writingSessions, settings);
		const composition = builder.withSizeTargets(shapes, { ...profile, compositionSettings: settings });
		const visualScale = visualCalibrationScale(shapes, settings, builder.hangulComposeOptions(profile));
		return { state, settings, shapes, compose: (codePoint) => builder.composedHangulParts(codePoint, shapes, composition, visualScale) };
	};
	const boxOf = (path) => {
		const box = path.getBoundingBox();
		return [box.x1, box.y1, box.x2, box.y2].map((value) => round(value, 0));
	};

	// A project that holds only the written cells: what the composer makes of them alone.
	const first = source.find((session) => session.exerciseId === EXERCISE);
	const inside = (stroke) => Math.floor(stroke.y / first.cellSize) * first.columns + Math.floor(stroke.x / first.cellSize) < count;
	const alone = load([{ ...first, elements: first.elements.filter(inside), boundaries: Object.fromEntries(Object.entries(first.boundaries).filter(([cellIndex]) => Number(cellIndex) < count)) }]);
	const session = alone.state.writingSessions[EXERCISE];
	const strength = alone.settings.endpointStabilization;
	const { cellSize, columns } = session;
	const cellOf = new Map(session.assignments.map((item) => [item.elementId, item]));

	const cells = exercise.cells.slice(0, count).map((cell, cellIndex) => {
		const corner = cellOrigin(cellIndex, columns, cellSize);
		const strokes = session.elements
			.filter((stroke) => !stroke.isDeleted && stroke.points.length > 1 && cellOf.get(stroke.id)?.cellIndex === cellIndex)
			.map((stroke) => {
				const diameter = penDiameter(stroke.strokeWidth, cellSize);
				const steady = stabilizeStroke(stroke.points, stroke.pressures, diameter, 'complete', strength).points;
				const place = (points) => points.map(([x, y]) => [round(stroke.x + x - corner.x), round(stroke.y + y - corner.y)]);
				return {
					role: cell.slots[cellOf.get(stroke.id).slotIndex].role,
					d: roundPath(strokeSvgPath(stroke, cellSize, strength)),
					x: round(stroke.x - corner.x),
					y: round(stroke.y - corner.y),
					points: place(steady.length > 1 ? steady : stroke.points),
					...(steady.length === stroke.points.length ? { raw: place(stroke.points) } : {}),
					diameter: round(diameter, 2)
				};
			});
		const forms = (slot) =>
			Array.from({ length: slot.role === 'initial' ? 8 : slot.role === 'medial' ? 2 : 1 }, (_, form) => {
				const shape = alone.shapes.get(sourceKey(slot.role, form, slot.char));
				return Boolean(shape && !shape.synthesized);
			});
		return { char: cell.char, jamo: cell.slots.map((slot) => ({ role: slot.role, char: slot.char, forms: forms(slot) })), strokes };
	});

	/** The jamo of a syllable as the written cells compose it, each with the cell it was written in. Undefined when a jamo is not one written jamo. */
	const rolesOf = (codePoint) => {
		const { path, parts, geometry } = alone.compose(codePoint);
		if (!path.commands.length) return undefined;
		const { chars, variants } = decomposeHangul(codePoint);
		const roles = syllableRoles(codePoint).map((role) => {
			const selected = selectJamoSource(alone.shapes, role, variants[role], chars[role]);
			const cell = Number(selected?.source.sourceCellId?.split(':')[1]);
			const from = cells[cell]?.jamo.find((jamo) => jamo.char === chars[role] && jamo.role === role) ?? cells[cell]?.jamo.find((jamo) => jamo.char === chars[role]);
			if (!from || !parts[role]?.commands.length) return undefined;
			const zone = geometry.zones[role];
			return { role, d: svgPathData(parts[role].commands, 0), box: boxOf(parts[role]), zone: zone && [zone.x1, zone.y1, zone.x2, zone.y2].map((value) => round(value, 0)), from: { cell, role: from.role }, match: selected.match };
		});
		return roles.every(Boolean) ? roles : undefined;
	};

	const composed = [...COMPOSED].map((char) => {
		const roles = rolesOf(char.codePointAt(0));
		if (!roles) throw new Error(`${char} does not compose from the written cells`);
		console.log(`${char}: ${roles.map((role) => `${role.role} ${cells[role.from.cell].char} (${role.match})`).join(', ')}`);
		return { char, roles: roles.map(({ match, ...role }) => role) };
	});

	// Every syllable the written cells compose alone. The film composes some of them one after the other, taken at even steps.
	let composable = 0;
	const others = [];
	for (let codePoint = 0xac00; codePoint <= 0xd7a3; codePoint += 1) {
		const { path, parts } = alone.compose(codePoint);
		if (!path.commands.length || !syllableRoles(codePoint).every((role) => parts[role]?.commands.length)) continue;
		composable += 1;
		const char = String.fromCodePoint(codePoint);
		const roles = COMPOSED.includes(char) ? undefined : rolesOf(codePoint);
		if (roles) others.push({ char, roles: roles.map(({ match, zone, ...role }) => role) });
	}
	const stream = Array.from({ length: Math.min(STREAM, others.length) }, (_, index) => others[Math.floor((index * others.length) / Math.min(STREAM, others.length))]);
	console.log(`the written cells compose ${composable} syllables; the film composes ${stream.length + composed.length}: ${stream.map((item) => item.char).join('')}`);

	const whole = load(source);
	const lines = CLOSING.map((text) => {
		let pen = 0;
		const pens = [];
		const glyphs = [...text].flatMap((char, index) => {
			pens.push(pen);
			const codePoint = char.codePointAt(0);
			if (!isHangulSyllable(codePoint)) {
				pen += SPACE_ADVANCE;
				return [];
			}
			const { path } = whole.compose(codePoint);
			if (!path.commands.length) throw new Error(`${char} does not compose`);
			const [x1, , x2] = boxOf(path);
			const proportional = whole.settings.widthMode === 'proportional';
			const x = proportional ? pen + SIDE_BEARING - x1 : pen;
			pen += proportional ? Math.max(100, x2 - x1 + SIDE_BEARING * 2) : 1000;
			return [{ char, index, x, d: svgPathData(prepareCffPath(path).commands, 0) }];
		});
		return { text, width: pen, pens: [...pens.slice(1), pen], glyphs };
	});

	const film = JSON.stringify({ cellSize, cells, composed, composable, stream, lines });
	writeFileSync(out, film);
	console.log(`${out}: ${cells.length} cells, ${cells.reduce((sum, cell) => sum + cell.strokes.length, 0)} strokes, ${Math.round(film.length / 1024)} KB`);
} finally {
	await server.close();
}
