import { jsPDF } from 'jspdf';
import type { IChar } from '../types/Types';
import qrcode from 'qrcode-generator';

export function exportPDF(datas: IChar[], qrData: String = '') {
	const doc = new jsPDF({});
	doc.addFont('IBMPlexSansKR-Light.ttf', 'IBMPlexSansKR-Light', 'normal');
	doc.setFont('IBMPlexSansKR-Light', 'normal');
	let page = doc;
	const bundle = bundleData(datas, 10, 11);
	for (let i = 0; i < bundle.length; i++) {
		if (i > 0) {
			page = doc.addPage();
		}
		const qr = genQR(`${i}.${qrData}`, 90, 90);
		page.addImage(qr, 10, 2, 18, 18);
		const lines = bundle[i];
		drawLandmark(page, 5, 13, 5);
		drawLandmark(page, 200, 13, 5, 1);
		drawLandmark(page, 5, 286, 5, 2); // margin: 2
		drawCharLines(page, lines, 5, 20, 20, 24);
	}
	doc.save('OwnChar.pdf');
}

function bundleData(datas: IChar[], x: number, y: number) {
	// for (let i = 0; i < datas.length; i += x * y) {
	// 	datas.splice(i, 0, { add: [], detail: '', type: '', unicode: 120 });
	// }
	// for (let i = x - 1; i < datas.length; i += x * y) {
	// 	datas.splice(i, 0, { add: [], detail: '', type: '', unicode: 121 });
	// }
	// for (let i = x * (y - 1); i < datas.length; i += x * y) {
	// 	datas.splice(i, 0, { add: [], detail: '', type: '', unicode: 122 });
	// }
	let bundle = arrayBundle(datas, x);
	bundle = arrayBundle(bundle, y);
	return bundle;
}

function drawCharLines(pdf: jsPDF, datas: IChar[][], x: number, y: number, w: number, h: number) {
	for (let i = 0; i < datas.length; i++) {
		const data = datas[i];
		drawCharLine(pdf, data, x, y + h * i, w, h);
	}
}

function drawCharLine(pdf: jsPDF, datas: IChar[], x: number, y: number, w: number, h: number) {
	for (let i = 0; i < datas.length; i++) {
		const data = datas[i];
		drawCharBox(pdf, data, x + w * i, y, w, h);
	}
}

function drawCharBox(pdf: jsPDF, data: IChar, x: number, y: number, w: number, h: number) {
	pdf.rect(x, y, w, h);
	pdf.line(x, y + 5, x + w, y + 5);
	pdf.setFontSize(9);
	pdf.text(String.fromCharCode(data.unicode), x + 2, y + 1, {
		baseline: 'top'
	});
}

function drawLandmark(page: jsPDF, x: number, y: number, w: number, type: number = 0) {
	const weight = w / 4;
	switch (type) {
		case 0:
			page.rect(x, y, weight, weight, 'f');
			break;
		case 1:
			page.rect(x + w - weight, y, weight, weight, 'f');
			break;
		case 2:
			page.rect(x, y + w - weight, weight, weight, 'f');
			break;
		case 3:
			page.rect(x + w - weight, y + w - weight, weight, weight, 'f');
			break;

		default:
			break;
	}
	// page.rect(x, y, w, w);
	page.rect(x, y + (w - weight) / 2, w, weight, 'f');
	page.rect(x + (w - weight) / 2, y, weight, w, 'f');
}

function arrayBundle(arr: any[], n: number) {
	const res = [];
	for (let i = 0; i < arr.length; i += n) {
		const e = arr[i];
		let tmp = arr.slice(i, i + n);
		if (i > arr.length - n) tmp.filter((n) => n);
		res.push(tmp);
	}
	return res;
}

function genQR(data: string, w: number, h: number) {
	let qr = qrcode(0, 'H');
	qr.addData(data);
	qr.make();
	return qr.createDataURL();
}
