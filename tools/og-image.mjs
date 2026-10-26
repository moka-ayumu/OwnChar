// node tools/og-image.mjs — renders public/og-image.png (1200x630) from HTML with the example handwriting.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const fontDir = pathToFileURL(fileURLToPath(new URL('node_modules/wanted-sans/fonts/ttf/', root))).href;
const example = JSON.parse(readFileSync(new URL('src/features/samples/example.json', root), 'utf8'));
const strokes = example.sessions[0].elements.filter((element) => element.points?.length > 1);

const box = strokes.reduce(
	(acc, { x, y, width, height }) => ({ x0: Math.min(acc.x0, x), y0: Math.min(acc.y0, y), x1: Math.max(acc.x1, x + width), y1: Math.max(acc.y1, y + height) }),
	{ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
);
/** The strokes written in one cell of a sentence, as an inline SVG sized to the text around it. */
const SENTENCES = ['흐린 퇴근길 휴대폰에 육 년 만에 옛 친구의 문자가 왔다', '관람권 사진과 극장 출구 뒤편 벤치에서 십 분만 보자는 얘기였다', '저녁녘 택시가 모퉁이를 도니 스웨터에 코트를 걸친 친구가 왼손으로 노란 꽃을 흔들었다'];
function handwritten(char) {
	const index = SENTENCES.findIndex((text) => text.includes(char));
	const { cellSize, columns, elements } = example.sessions[index];
	const cell = [...SENTENCES[index]].indexOf(char);
	const left = (cell % columns) * cellSize;
	const top = Math.floor(cell / columns) * cellSize;
	const inCell = elements.filter(({ x, y, width, height }) => x + width / 2 >= left && x + width / 2 < left + cellSize && y + height / 2 >= top && y + height / 2 < top + cellSize);
	const d = inCell.map(({ x, y, points }) => `M${points.map(([px, py]) => `${(x + px).toFixed(1)} ${(y + py).toFixed(1)}`).join('L')}`).join('');
	const b = inCell.reduce((acc, { x, y, width, height }) => ({ x0: Math.min(acc.x0, x), y0: Math.min(acc.y0, y), x1: Math.max(acc.x1, x + width), y1: Math.max(acc.y1, y + height) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
	// A square box centred on the strokes, so every glyph sits at the same height in the line. One em of text is about 76 cell units.
	const side = 96;
	const cx = (b.x0 + b.x1) / 2;
	const cy = (b.y0 + b.y1) / 2;
	return `<svg class="hand" viewBox="${(cx - side / 2).toFixed(1)} ${(cy - side / 2).toFixed(1)} ${side} ${side}"><path d="${d}"/></svg>`;
}
const pad = 6;
const viewBox = `${box.x0 - pad} ${box.y0 - pad} ${box.x1 - box.x0 + pad * 2} ${box.y1 - box.y0 + pad * 2}`;
const paths = strokes.map(({ x, y, points }) => `<path d="M${points.map(([px, py]) => `${(x + px).toFixed(1)} ${(y + py).toFixed(1)}`).join('L')}"/>`).join('');

const face = (weight, file) => `@font-face{font-family:'Wanted';font-weight:${weight};src:url('${fontDir}${file}')}`;
const html = `<!doctype html><meta charset="utf-8"><style>
${face(500, 'WantedSans-Medium.ttf')}${face(700, 'WantedSans-Bold.ttf')}${face(800, 'WantedSans-ExtraBold.ttf')}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#ecede8;color:#101114;font-family:Wanted,sans-serif;position:relative;overflow:hidden}
.brand{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:14px;font-size:30px;font-weight:800;letter-spacing:-0.03em}
.mark{width:44px;height:44px;border-radius:11px;background:#101114;display:grid;place-items:center}
.mark i{width:18px;height:18px;border-radius:50%;background:#c6f432}
h1{position:absolute;left:72px;top:232px;font-size:76px;line-height:1.38;font-weight:800;letter-spacing:-0.03em}
h1 em{font-style:normal;position:relative;display:inline-block;margin-right:0.04em}
h1 em .rule{position:absolute;left:-0.04em;right:-0.06em;bottom:-0.2em;width:calc(100% + 0.1em);height:0.3em;overflow:visible;fill:none;stroke:#c6f432;stroke-width:9;stroke-linecap:round}
h1 em .hand{width:1.26em;height:1.26em;margin:-0.3em -0.2em -0.3em -0.12em;vertical-align:0.06em;overflow:visible;fill:none;stroke:#101114;stroke-width:9;stroke-linecap:round;stroke-linejoin:round}
.card{position:absolute;right:64px;top:64px;width:420px;height:502px;background:#fff;border-radius:28px;border:2px solid #d9dad5;padding:36px 30px;display:grid;place-items:center}
.card svg{width:100%;height:auto;max-height:100%;fill:none;stroke:#101114;stroke-width:7.5;stroke-linecap:round;stroke-linejoin:round}
</style>
<div class="brand"><span class="mark"><i></i></span>OwnChar</div>
<h1>내 손글씨가<br><em>${handwritten('폰')}${handwritten('트')}<svg class="rule" viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M4 12 C40 5 80 16 120 9 S180 7 196 11"/></svg></em>가 됩니다</h1>
<div class="card"><svg viewBox="${viewBox}">${paths}</svg></div>`;

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
	await page.setContent(html);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: fileURLToPath(new URL('public/og-image.png', root)) });
} finally {
	await browser.close();
}
console.log('wrote public/og-image.png (1200x630)');
