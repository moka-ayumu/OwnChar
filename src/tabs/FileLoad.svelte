<script lang="ts">
	import adobekr9 from '../Adobe-KR-9_ordering.json';
	import { bitmapToData } from '$lib/Utils';
	import opentype from 'opentype.js';
	import QrScanner from 'qr-scanner';
	import type { IChar, IImages } from 'src/types/Types';
	import { createEventDispatcher } from 'svelte';
	import { DownloadIcon, FileIcon } from 'svelte-feather-icons';
	let inputPdf: FileList;
	import ZipWorker from '../lib/worker/Zip?worker';
	import { exportPDF } from '$lib/Writer';
	export let images: IImages[] = [];
	export let font: opentype.Font | undefined;

	const diapatch = createEventDispatcher();
	let zipLoading = false;

	function load() {
		console.log(inputPdf);
		if (inputPdf[0].type === 'application/x-zip-compressed') {
			const worker = new ZipWorker();
			zipLoading = true;
			worker.onmessage = (e) => {
				const { data } = e;
				if (data.type === 'unzip') {
					const datas: ImageBitmap[] = data.data;
					let complete = 0;
					for (let i = 0; i < datas.length; i++) {
						QrScanner.scanImage(datas[i], { returnDetailedScanResult: true }).then((qr) => {
							const imgData = bitmapToData(datas[i]);
							let x = 10,
								y = 10,
								scale = 1;
							let posFind = false,
								scaleFind = false;
							if (imgData !== undefined) {
								for (let w = 0; w < imgData.width; w++) {
									for (let h = 0; h < imgData.height; h++) {
										const pos = imgData.width * 4 * h + w * 4;
										const color = imgData.data.slice(pos, pos + 4);
										if (color[0] < 50 && color[1] < 50 && color[2] < 50) {
											x = w;
											y = h;
											posFind = true;
											break;
										}
									}
									if (posFind) break;
								}

								for (let w = imgData.width - 1; w >= 0; w--) {
									for (let h = 0; h < imgData.height; h++) {
										const pos = imgData.width * 4 * h + w * 4;
										const color = imgData.data.slice(pos, pos + 4);
										if (color[0] < 50 && color[1] < 50 && color[2] < 50) {
											scale = (w - x) / 1000;
											scaleFind = true;
											break;
										}
									}
									if (scaleFind) break;
								}
							}
							images.push({
								qr: qr.data,
								data: datas[i],
								scale,
								x,
								y
							});
							complete++;
							images.sort((a, b) => Number(a.qr.split('.')[0]) - Number(b.qr.split('.')[0]));
							if (complete === datas.length) {
								images = images;
								diapatch('complete', { type: 'zip' });
								zipLoading = false;
							}
						});
					}
				}
				worker.terminate();
			};
			worker.postMessage({
				type: 'zip',
				data: inputPdf[0]
			});
		} else if (inputPdf[0].name.endsWith('.otf')) {
			inputPdf[0].arrayBuffer().then((buffer) => {
				const loadFont = opentype.parse(buffer);
				console.log(loadFont);
				if (loadFont.supported && loadFont.names.manufacturer.en === 'OwnChar') {
					font = loadFont;
					diapatch('complete', { type: 'otf' });
				} else {
					alert('지원되지 않는 폰트입니다.');
				}
			});
		}
	}

	function mouseenter(e: MouseEvent) {
		const p = e.target as HTMLParagraphElement;
		const svg = p.getElementsByTagName('svg');
		svg[0].style.strokeDashoffset = '0';
	}
	function mouseleave(e: MouseEvent) {
		const p = e.target as HTMLParagraphElement;
		const svg = p.getElementsByTagName('svg');
		svg[0].style.strokeDashoffset = '132';
	}
	function mousedownloadleave(e: MouseEvent) {
		const p = e.target as HTMLParagraphElement;
		const svg = p.getElementsByTagName('svg');
		svg[0].style.strokeDashoffset = '58';
	}

	function download() {
		// let all: IChar[] = adobekr9[0];
		// let qrData = `0-0-${all.length}.`;
		// exportPDF(all, qrData);
		window.open('/OwnChar.zip', '_self');
	}
</script>

<div class="root">
	<div>
		<div on:mouseenter={mouseenter} on:mouseleave={mousedownloadleave} on:click={download} class="fileLabel download">
			<DownloadIcon size="60" class="animDownload" />
			<p class="title">1. 손글씨 ZIP 파일 다운로드</p>
			<p class="detail">파일을 다운받고 그 위에 당신만의 글씨를 써주세요!</p>
		</div>
		<label for="pdf" on:mouseenter={mouseenter} on:mouseleave={mouseleave} class="fileLabel">
			<FileIcon size="60" class="animFile" />
			<p class="title">{zipLoading ? '분석중' : '2. .zip/.otf 파일 업로드'}</p>
			<p class="detail">
				{zipLoading ? '완료되면 자동으로 페이지가 넘어갑니다' : '각 페이지를 jpg 또는 png로 변환하여 압축 / 기존 폰트 수정'}
			</p>
		</label>
		<input type="file" name="pdf" id="pdf" bind:files={inputPdf} accept=".zip,.otf" on:change={load} disabled={zipLoading} />
	</div>
	<!-- <button type="button" on:click={load}>zip load</button> -->
</div>

<style lang="scss">
	.root {
		flex-shrink: 0;
		width: 100%;
		display: flex;
		& > div {
			margin: auto;
			display: flex;
			flex-direction: column;
			gap: 50px;
		}
	}

	label {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 20px;
		font-size: 50px;
	}

	input[type='file'] {
		display: none;
	}

	p {
		margin: 0;
	}

	.detail {
		font-size: 25px;
	}

	:global(.animFile) {
		stroke-dashoffset: 132;
		stroke-dasharray: 66;
		transition: all 1s cubic-bezier(0.075, 0.82, 0.165, 1);

		// animation: keyFile 3s ease infinite alternate 0.5s;

		// @keyframes keyFile {
		// 	0% {
		// 		stroke-dashoffset: 66;
		// 	}
		// 	70% {
		// 		stroke-dashoffset: 0;
		// 	}
		// 	100% {
		// 		stroke-dashoffset: 0;
		// 	}
		// }
	}

	:global(.animDownload) {
		stroke-dashoffset: 58;
		stroke-dasharray: 29;
		transition: all 1s cubic-bezier(0.075, 0.82, 0.165, 1);
	}

	.fileLabel {
		transition: all 1s cubic-bezier(0.075, 0.82, 0.165, 1);
		&:hover {
			transform: scale(1.1);
		}
	}

	.title {
		font-size: 40px;
		font-weight: 600;
	}

	.download {
		display: flex;
		flex-direction: column;
		justify-items: center;
		align-items: center;
		gap: 20px;
		cursor: default;
	}
</style>
