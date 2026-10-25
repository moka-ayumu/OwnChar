// node tools/reference/compare-noto.mjs [글자들] [--cols=3] [--stats] [--worst=60] [--out=sheet.svg]
// Noto Sans KR(회색)는 공간 관계만 참고한다. 표시한 비율은 설명 값이며 최적화 지표가 아니다.
// --stats : 전체 11,172자의 NaN·넘침·충돌·누락 검사와 이상 사례 시트를 만든다.
import { execFileSync } from 'node:child_process';
import { readOutJson, writeOut } from '../lib/out.mjs';
import { loadNoto, notoCommands } from '../lib/noto.mjs';
import { loadProject } from '../lib/project.mjs';
import { pathData } from '../lib/svg.mjs';
import { startVite } from '../lib/vite.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const chars = [...(args.find((a) => !a.startsWith('--')) ?? '괌낡넘뢒뢥꽈깲뇲줬계뭐가고구그각곡굵읽닭')];
const columns = Number(flag('cols', 3));
const wantStats = args.includes('--stats');
const worstCount = Number(flag('worst', 60));
const outName = flag('out', 'sheet.svg');

const noto = loadNoto();
const project = await loadProject();
const revision = flag('revision', '');
const server = await startVite({ revision });

/** Metrics of a glyph given its path commands in font units (y up): body aspect and the ink centroid. */
function metrics(commands) {
	const contours = [];
	let current = [];
	for (const c of commands) {
		if (c.type === 'M') {
			if (current.length) contours.push(current);
			current = [];
		}
		if (c.x !== undefined) current.push([c.x, -c.y]);
		if (c.x1 !== undefined) current.push([c.x1, -c.y1]);
	}
	if (current.length) contours.push(current);
	if (!contours.length) return null;
	const all = contours.flat();
	const x1 = Math.min(...all.map((p) => p[0]));
	const x2 = Math.max(...all.map((p) => p[0]));
	const y1 = Math.min(...all.map((p) => p[1]));
	const y2 = Math.max(...all.map((p) => p[1]));
	let area = 0;
	let cx = 0;
	let cy = 0;
	for (const points of contours) {
		let a = 0;
		let px = 0;
		let py = 0;
		for (let i = 0; i < points.length; i += 1) {
			const [ax, ay] = points[i];
			const [bx, by] = points[(i + 1) % points.length];
			const cross = ax * by - bx * ay;
			a += cross;
			px += (ax + bx) * cross;
			py += (ay + by) * cross;
		}
		area += a / 2;
		cx += px / 6;
		cy += py / 6;
	}
	const w = x2 - x1;
	const h = y2 - y1;
	return { w, h, aspect: w / h, cx: area ? (cx / area - x1) / w : 0.5, cy: area ? (cy / area - y1) / h : 0.5 };
}

try {
	const inputs = await server.ssrLoadModule('/src/generation/inputs.ts');
	const composer = await server.ssrLoadModule('/src/generation/font-builder.ts');
	const settings = project.compositionSettings;
	const generation = inputs.buildGenerationInputs(project.drawings, project.writingSessions ?? {}, settings);
	const request = { ...generation, ...(args.includes('--nolock') ? { lockedSyllables: {} } : {}), compositionSettings: settings };
	const prepared = composer.prepareCompositionContext(request);
	const ours = (cp) => composer.composedHangulPath(cp, prepared.shapes, request, prepared.visualScale);

	function sheet(list, file, title) {
		const size = 200;
		const pairWidth = size * 2 + 10;
		const cellHeight = size + 62;
		const rows = Math.ceil(list.length / columns);
		const body = list
			.map((cp, index) => {
				const x = (index % columns) * (pairWidth + 20);
				const y = Math.floor(index / columns) * cellHeight;
				const hasFinal = (cp - 0xac00) % 28 !== 0;
				const nc = notoCommands(noto, String.fromCodePoint(cp));
				const oc = ours(cp).commands;
				const nm = metrics(nc);
				const om = metrics(oc);
				const fmt = (m) => (m ? `${m.aspect.toFixed(2)} (${Math.round(m.w)}x${Math.round(m.h)}) ink-y approx ${Math.round(m.cy * 100)}%` : '-');
				const glyph = (commands, ox, fill) =>
					`<g transform="translate(${ox} ${y + size * 0.88}) scale(${size / 1000} ${-size / 1000})"><rect x="0" y="-120" width="1000" height="1000" fill="none" stroke="#ddd" stroke-width="4"/><path d="${pathData(commands, 1)}" fill="${fill}"/></g>`;
				return `${glyph(nc, x, '#9a9a9a')}${glyph(oc, x + size + 10, '#111')}<text x="${x}" y="${y + 14}" font-size="14" fill="#c33">${String.fromCodePoint(cp)}</text><text x="${x}" y="${y + size + 18}" font-size="11" fill="#555">Noto ${fmt(nm)}</text><text x="${x}" y="${y + size + 33}" font-size="11" fill="#111">ours ${fmt(om)}</text>`;
			})
			.join('\n');
		writeOut(
			file,
			`<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${columns * (pairWidth + 20)} ${rows * cellHeight + 24}"><rect width="100%" height="100%" fill="#fff"/><text x="4" y="${rows * cellHeight + 16}" font-size="12" fill="#666">${title}</text>${body}</svg>`
		);
		console.log(`wrote tools/out/${file}`);
	}

	sheet(
		chars.map((c) => c.codePointAt(0)),
		outName,
		'gray = Noto Sans KR, black = ours'
	);

	if (wantStats) {
		const reportName = revision ? 'head-audit' : 'layout-audit';
		const output = execFileSync(process.execPath, ['tools/verify/validate-layout.mjs', '--all', `--out=${reportName}`, ...(revision ? [`--revision=${revision}`] : [])], { encoding: 'utf8' });
		console.log(output);
		const report = readOutJson(`${reportName}.json`);
		if (report.failures.length)
			sheet(
				report.failures.slice(0, worstCount).map((f) => f.char.codePointAt(0)),
				'worst.svg',
				'Actual ink collision, overflow or missing role; Noto aspect ratio is not a quality target'
			);
	}
} finally {
	await server.close();
}
