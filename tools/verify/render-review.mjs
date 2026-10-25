// node tools/verify/render-review.mjs
// Renders the audits of validate-layout side by side: Noto (context), HEAD and the working tree.
import { readOutJson, writeOut } from '../lib/out.mjs';
import { loadNoto, notoCommands, opentype } from '../lib/noto.mjs';
import { pathData } from '../lib/svg.mjs';
import { startVite } from '../lib/vite.mjs';

const before = readOutJson('head-audit.json');
const after = readOutJson('layout-audit.json');
const noto = loadNoto();
const colors = { initial: '#2563eb', medial: '#c02673', final: '#16834b' };

async function measureInkGaps() {
	const gaps = {};
	const server = await startVite();
	try {
		const { hasInkClearance } = await server.ssrLoadModule('/src/font/geometry/collision.ts');
		for (const [char, entry] of Object.entries(after.entries)) {
			gaps[char] = [
				['initial', 'medial', 'I-M'],
				['medial', 'final', 'M-F']
			]
				.flatMap(([roleA, roleB, label]) => {
					const a = entry.parts[roleA];
					const b = entry.parts[roleB];
					if (!a?.length || !b?.length) return [];
					const first = new opentype.Path();
					first.commands = a;
					const second = new opentype.Path();
					second.commands = b;
					let low = 0;
					let high = 200;
					for (let step = 0; step < 9; step++) {
						const mid = (low + high) / 2;
						if (hasInkClearance(first, second, mid)) low = mid;
						else high = mid;
					}
					return [`${label} ${low.toFixed(1)}`];
				})
				.join(' / ');
		}
	} finally {
		await server.close();
	}
	return gaps;
}
const inkGaps = await measureInkGaps();

function sheet(list, name, columns = 3, geometry = false) {
	const cellWidth = 560;
	const cellHeight = 232;
	const rows = Math.ceil(list.length / columns);
	const body = list
		.map((char, index) => {
			const x = (index % columns) * cellWidth;
			const y = Math.floor(index / columns) * cellHeight + 50;
			const b = before.entries[char];
			const a = after.entries[char];
			const glyph = (commands, offset, fill, extra = '') =>
				`<g transform="translate(${x + offset} ${y + 166}) scale(.16 -.16)"><rect x="0" y="-150" width="1000" height="1050" fill="none" stroke="#ddd" stroke-width="4"/><path d="${pathData(commands)}" fill="${fill}"/>${extra}</g>`;
			let overlay = '';
			if (geometry && a?.geometry) {
				overlay = Object.entries(a.geometry.zones)
					.map(([role, z]) => `<rect x="${z.x1}" y="${z.y1}" width="${z.x2 - z.x1}" height="${z.y2 - z.y1}" fill="${colors[role]}" fill-opacity=".04" stroke="${colors[role]}" stroke-opacity=".3" stroke-dasharray="12 10" stroke-width="3"/>`)
					.join('');
				overlay += Object.entries(a.geometry.anchors)
					.map(([role, p]) => `<path d="M${p.x - 15} ${p.y}H${p.x + 15}M${p.x} ${p.y - 15}V${p.y + 15}" fill="none" stroke="${colors[role]}" stroke-width="5"/>`)
					.join('');
				overlay += Object.entries(a.parts)
					.map(([role, commands]) => `<path d="${pathData(commands)}" fill="${colors[role]}"/>`)
					.join('');
			}
			const label = (offset, text) => `<text x="${x + offset}" y="${y + 192}" font-size="11"${offset ? '' : ' fill="#777"'}>${text}</text>`;
			return (
				`<text x="${x}" y="${y - 8}" font-size="14">${char}</text>` +
				glyph(notoCommands(noto, char), 0, '#aaa') +
				glyph(b?.commands ?? [], 185, '#111') +
				glyph(a?.commands ?? [], 370, geometry ? '#aaa' : '#111', overlay) +
				label(0, 'Noto') +
				label(185, `HEAD${b?.overlaps.length ? ` / collision ${b.overlaps.length}` : ''}`) +
				label(370, `After${a?.overlaps.length ? ` / collision ${a.overlaps.length}` : ''}`) +
				(geometry ? `<text x="${x + 370}" y="${y + 210}" font-size="9">Ink gap ~ ${inkGaps[char] ?? ''} (units)</text>` : '')
			);
		})
		.join('\n');
	const legend = `Same handwriting source: Noto (context) / HEAD / After${geometry ? ' — initial blue, medial magenta, final green; crosses = centers' : ''}`;
	writeOut(
		`${name}.svg`,
		`<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${columns * cellWidth} ${rows * cellHeight + 58}"><rect width="100%" height="100%" fill="white"/><text x="8" y="20" font-size="13">${legend}</text>${body}</svg>`
	);
	console.log(`wrote tools/out/${name}.svg`);
}

sheet(after.required, 'review');
sheet([...'괌뢒뢥줬깲각곡굵읽'], 'review-feedback');
sheet(after.required, 'review-spaces', 3, true);
sheet(['낡', '뢒', '뢥', '줬'], 'review-focus', 2, true);
sheet(after.matrix, 'review-matrix', 4);
for (let page = 0; page < 3; page++) sheet(after.matrix.slice(page * 28, (page + 1) * 28), `review-matrix-${page + 1}`, 4);
sheet(after.matrix, 'review-matrix-spaces', 4, true);
const worst = [...new Set([...after.failures.map((f) => f.char), ...before.failures.filter((f) => after.entries[f.char] && before.entries[f.char]).map((f) => f.char)])].slice(0, 60);
if (worst.length) sheet(worst, 'review-regressions', 4, true);
