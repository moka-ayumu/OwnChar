export function cropImageData(data: ImageData, x: number, y: number, w: number, h: number) {
	let res: number[] = [];
	w = Math.round(w);
	h = Math.round(h);
	for (let i = y; i < y + h; i++) {
		const start = (data.width * i + x) * 4;
		const end = start + w * 4;
		res.push(...data.data.slice(start, end));
	}
	return new ImageData(new Uint8ClampedArray(res), w, h);
}

export function bitmapToData(bitmap: ImageBitmap) {
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d');
	if (ctx !== null) {
		ctx.drawImage(bitmap, 0, 0);
		return ctx.getImageData(0, 0, canvas.width, canvas.height);
	}
}
