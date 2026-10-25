import { expect, test } from '@playwright/test';
import opentype from 'opentype.js';
import { prepareCffPath } from '../../src/font/geometry/cff';
import { strokeSvgPath } from '../../src/font/stroke/outline';

// What the browser actually paints: these cannot be checked from the outline data alone.

test('an overlapping CFF glyph is solid only after its contours are merged', async ({ page }, testInfo) => {
	const raw = new opentype.Path();
	raw.moveTo(100, 400);
	raw.lineTo(600, 400);
	raw.lineTo(600, 500);
	raw.lineTo(100, 500);
	raw.close();
	raw.moveTo(300, 200);
	raw.lineTo(400, 200);
	raw.lineTo(400, 700);
	raw.lineTo(300, 700);
	raw.close();
	const glyphs = [
		new opentype.Glyph({ name: '.notdef', index: 0, advanceWidth: 1000, path: new opentype.Path() }),
		new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 1000, path: new opentype.Path() }),
		new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 1000, path: raw }),
		new opentype.Glyph({ name: 'B', unicode: 66, advanceWidth: 1000, path: prepareCffPath(raw) })
	];
	const font = new opentype.Font({ familyName: 'CffOverlapTest', styleName: 'Regular', unitsPerEm: 1000, ascender: 900, descender: -100, glyphs });
	await page.goto('/');
	// Alpha at the crossing of the two bars, for the raw (A) and merged (B) glyph.
	const pixels = await page.evaluate(
		async (bytes) => {
			const face = new FontFace('CffOverlapTest', new Uint8Array(bytes).buffer);
			await face.load();
			document.fonts.add(face);
			return [36, 72, 144].map((size) =>
				[1, 2].map((ratio) => {
					const canvas = document.createElement('canvas');
					canvas.width = 160 * ratio;
					canvas.height = 160 * ratio;
					const context = canvas.getContext('2d')!;
					context.scale(ratio, ratio);
					context.font = `${size}px CffOverlapTest`;
					context.fillText('A', 10, 100);
					context.fillText('B', 80, 100);
					const y = Math.round((100 - size * 0.45) * ratio);
					return {
						raw: context.getImageData(Math.round((10 + size * 0.35) * ratio), y, 1, 1).data[3],
						merged: context.getImageData(Math.round((80 + size * 0.35) * ratio), y, 1, 1).data[3]
					};
				})
			);
		},
		Array.from(new Uint8Array(font.toArrayBuffer()))
	);
	if (testInfo.project.name === 'chromium') expect(pixels[0][0].raw).toBeLessThan(50);
	for (const sizes of pixels) for (const pixel of sizes) expect(pixel.merged).toBeGreaterThan(200);
});

test('a closed stroke is painted with its seam filled and its centre clear', async ({ page }) => {
	await page.goto('/');
	const points: [number, number][] = [
		[50, 30],
		[64, 36],
		[70, 50],
		[64, 64],
		[50, 70],
		[36, 64],
		[30, 50],
		[36, 36],
		[50, 30]
	];
	const d = strokeSvgPath({ id: 'loop', x: 0, y: 0, width: 40, height: 40, points, pressures: points.map(() => 1), strokeWidth: 10 / 4.25, version: 1 }, 148);
	const pixels = await page.evaluate(async (path) => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="${path}" fill="black" fill-rule="nonzero"/></svg>`;
		const image = new Image();
		image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = 100;
		canvas.height = 100;
		const context = canvas.getContext('2d')!;
		context.drawImage(image, 0, 0);
		return { seam: context.getImageData(50, 30, 1, 1).data[3], centre: context.getImageData(50, 50, 1, 1).data[3] };
	}, d);
	expect(pixels.seam).toBeGreaterThan(200);
	expect(pixels.centre).toBe(0);
});
