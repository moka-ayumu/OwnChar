// node tools/verify/snap.mjs sheet.svg [width] — renders tools/out/<file> to a PNG with the same name.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { outUrl } from '../lib/out.mjs';

const name = process.argv[2] ?? 'sheet.svg';
const width = Number(process.argv[3] ?? 1400);
const file = outUrl(name);
const viewBox = readFileSync(file, 'utf8').match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
if (!viewBox) {
	console.error(`${name} has no viewBox="0 0 W H".`);
	process.exit(1);
}
const height = Math.ceil((width * Number(viewBox[2])) / Number(viewBox[1]));
const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
	await page.goto(file.href);
	await page.screenshot({ path: fileURLToPath(file).replace(/\.svg$/, '.png'), clip: { x: 0, y: 0, width, height } });
} finally {
	await browser.close();
}
console.log(`wrote tools/out/${name.replace(/\.svg$/, '.png')} (${width}x${height})`);
