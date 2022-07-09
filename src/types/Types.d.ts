export interface IChar {
	add: string[];
	detail: string;
	type: string;
	unicode: number;
}

export interface IConColor {
	start: number;
	end: number;
}

export interface IImages {
	qr: String;
	data: ImageBitmap;
	// imageData: ImageData;
	scale: number;
	x: number;
	y: number;
}

export interface IGlyph {
	glyph: opentype.Glyph;
	left: number;
	right: number;
	y: number;
	scale: number;
	prevScale: number;
	rotate: number;
	prevRotate: number;
}

export interface IMargin {
	left: number;
	right: number;
	y: number;
}
