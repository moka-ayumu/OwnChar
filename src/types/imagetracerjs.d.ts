// declare module '*';
declare module 'imagetracerjs' {
	export function appendSVGString(svgstr: string, parentid: string);
	export function batchinternodes(bpaths: IPath[], options: IOption): IIns[];
	export function batchpathscan(layers: ILayers, pathomit: number): IPath[];
	export function batchtracelayers(binternodes: IIns[], ltres: number, qtres: number): ISmp[][];
	export function batchtracepaths(internodepaths: IIns[], ltres: number, qtres: number): ISmp[];
	export function blur(imgd: ImageData, radius: number, delta: number): ImageData;
	export function boundingboxincludes(parentbbox: IBoundingBox, childbbox: IBoundingBox): boolean;
	export function checkoptions(options: IPreset | IOptionQ): IOption;
	export function colorquantization(imgd: ImageData, options: IOption): IColorQuantization;
	export function compareNumbers(a: number, b: number): number;
	export function drawLayers(layers: ILayers, palette: IColor[], scale: number, parentid: string);
	export function fitseq(
		path: IIns,
		ltres: number,
		qtres: number,
		seqstart: number,
		seqend: number
	): ISegments;
	export function generatepalette(numberofcolors: number): IColor[];
	export function getImgdata(canvas: HTMLCanvasElement): ImageData;
	export function getdirection(x1, y1, x2, y2): number;
	export function getsvgstring(tracedata: ITraceData, options: IOptionQ): string;
	export function imageToSVG(url: string, callback: (svg: string) => void, options: IOptionQ);
	export function imageToTracedata(
		url: string,
		callback: (data: ITraceData) => void,
		options: IOptionQ
	);
	export function imagedataToSVG(imgd: ImageData, options: IOptionQ): string;
	export function imagedataToTracedata(imgd: ImageData, options: IPreset | IOptionQ): ITraceData;
	export function internodes(paths: IPath, options: IOption): IIns[];
	export function layering(ii: IColorQuantization): ILayers;
	export function layeringstep(ii: IColorQuantization, cnum: number): number[][];
	export function loadImage(
		url: string,
		callback: (canvas: HTMLCanvasElement) => void,
		options: IOptionQ
	);
	export function pathscan(arr: number[][], pathomit: number): IPath;
	export function pointinpoly(p: { x: number; y: number }, pa: { x: number; y: number }[]): boolean;
	export function roundtodec(val: number, places: number): number;
	export function samplepalette(numberofcolors: number, imgd: ImageData): IColor[];
	export function samplepalette2(numberofcolors: number, imgd: ImageData): IColor[];
	export function svgpathstring(
		tracedata: ITraceData,
		lnum: number,
		pathnum: number,
		options: IOptionSvg
	): string;
	export function testrightangle(
		path: IPath,
		idx1: number,
		idx2: number,
		idx3: number,
		idx4: number,
		idx5: number
	);
	export function torgbastr(c: IColor): string;
	export function tosvgcolorstr(c: IColor, options: IOptionSvgColor): string;
	export function tracepath(path: IIns, ltres: number, qtres: number): ISmp;
	export const gks: number[][];
	export const optionpresets: {
		artistic1: {
			blurdelta: number;
			blurradius: number;
			colorquantcycles: number;
			colorsampling: number;
			linefilter: boolean;
			ltres: number;
			numberofcolors: number;
			pathomit: number;
			strokewidth: number;
		};
		artistic2: {
			colorquantcycles: number;
			colorsampling: number;
			numberofcolors: number;
			qtres: number;
			strokewidth: number;
		};
		artistic3: {
			ltres: number;
			numberofcolors: number;
			qtres: number;
		};
		artistic4: {
			blurdelta: number;
			blurradius: number;
			ltres: number;
			numberofcolors: number;
			qtres: number;
			strokewidth: number;
		};
		curvy: {
			linefilter: boolean;
			ltres: number;
			rightangleenhance: boolean;
		};
		default: IOption;
		detailed: {
			ltres: number;
			numberofcolors: number;
			pathomit: number;
			qtres: number;
			roundcoords: number;
		};
		fixedpalette: {
			colorquantcycles: number;
			colorsampling: number;
			numberofcolors: number;
		};
		grayscale: {
			colorquantcycles: number;
			colorsampling: number;
			numberofcolors: number;
		};
		posterized1: {
			colorsampling: number;
			numberofcolors: number;
		};
		posterized2: {
			blurradius: number;
			numberofcolors: number;
		};
		posterized3: {
			blurdelta: number;
			blurradius: number;
			colorquantcycles: number;
			colorsampling: number;
			linefilter: boolean;
			ltres: number;
			mincolorratio: number;
			numberofcolors: number;
			pal: IColor[];
			pathomit: number;
			qtres: number;
			rightangleenhance: boolean;
			roundcoords: number;
			strokewidth: number;
		};
		randomsampling1: {
			colorsampling: number;
			numberofcolors: number;
		};
		randomsampling2: {
			colorsampling: number;
			numberofcolors: number;
		};
		sharp: {
			linefilter: boolean;
			qtres: number;
		};
		smoothed: {
			blurdelta: number;
			blurradius: number;
		};
	};
	export const pathscan_combined_lookup: number[][][];
	export const specpalette: IColor[];
	export const versionnumber: number;

	export type ILayers = number[][][];
	export type IPreset =
		| 'default'
		| 'posterized1'
		| 'posterized2'
		| 'curvy'
		| 'sharp'
		| 'detailed'
		| 'smoothed'
		| 'grayscale'
		| 'fixedpalette'
		| 'randomsampling1'
		| 'randomsampling2'
		| 'artistic1'
		| 'artistic2'
		| 'artistic3'
		| 'artistic4'
		| 'posterized3';

	export type IBoundingBox = [number, number, number, number];

	export type ISegments = (IL | IQ)[];

	export interface ITraceData {
		layers: ISmp[][];
		palette: IColor[];
		width: number;
		height: number;
	}

	export interface ISmp {
		segments: ISegments;
		boundingbox: IBoundingBox;
		holechildren: number[];
		isholepath: boolean;
	}

	export interface IIns {
		points: {
			linesegment: number;
			x: number;
			y: number;
		}[];
		boundingbox: IBoundingBox;
		holechildren: number[];
		isholepath: boolean;
	}

	export interface IPath {
		points: IPoint;
		boundingbox: IBoundingBox;
		holechildren: number[];
		isholepath: boolean;
	}

	export interface IPoint {
		linesegment: number;
		x: number;
		y: number;
		t: number;
	}

	export interface IColor {
		r: number;
		g: number;
		b: number;
		a: number;
	}

	export interface IColorQuantization {
		array: number[][];
		palette: IColor[];
	}

	export interface IOption {
		blurdelta: number;
		blurradius: number;
		colorquantcycles: number;
		colorsampling: number;
		corsenabled: boolean;
		desc: boolean;
		layering: number;
		lcpr: number;
		linefilter: boolean;
		ltres: number;
		mincolorratio: number;
		numberofcolors: number;
		pathomit: number;
		qcpr: number;
		qtres: number;
		rightangleenhance: boolean;
		roundcoords: number;
		scale: number;
		strokewidth: number;
		viewbox: boolean;
		layercontainerid?: string;
	}

	export interface IOptionSvg {
		desc: boolean;
		lcpr: number;
		linefilter: boolean;
		qcpr: number;
		roundcoords: number;
		scale: number;
	}

	export interface IOptionSvgColor {
		strokewidth: number;
	}

	export interface IOptionQ {
		blurdelta?: number;
		blurradius?: number;
		colorquantcycles?: number;
		colorsampling?: number;
		corsenabled?: boolean;
		desc?: boolean;
		layering?: number;
		lcpr?: number;
		linefilter?: boolean;
		ltres?: number;
		mincolorratio?: number;
		numberofcolors?: number;
		pathomit?: number;
		qcpr?: number;
		qtres?: number;
		rightangleenhance?: boolean;
		roundcoords?: number;
		scale?: number;
		strokewidth?: number;
		viewbox?: boolean;
		layercontainerid?: string;
	}

	export interface IL {
		type: 'L';
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	}

	export interface IQ {
		type: 'Q';
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		x3: number;
		y3: number;
	}
}
