<script lang="ts">
	import type { IChar, IImages } from 'src/types/Types';
	import { createEventDispatcher, onMount } from 'svelte';
	export let images: IImages[] = [];
	import opentype from 'opentype.js';
	import type ImageTracer from 'imagetracerjs';
	import adobekr9 from '../Adobe-KR-9_ordering.json';
	import TraceWorker from '../lib/worker/Trace?worker';
	import { animate } from 'popmotion';
	import { LayersIcon } from 'svelte-feather-icons';
	import NoFile from '../components/NoFile.svelte';

	const dispatch = createEventDispatcher();

	let allCount = 0;
	let comCount = 0;
	let glyphs: opentype.Glyph[] = [
		new opentype.Glyph({
			name: '.notdef',
			unicode: 0,
			advanceWidth: 200,
			path: new opentype.Path()
		})
	];
	let traceWorker: Worker;
	let dashOffset = 0;
	let isProgress = false;
	let maxLen = 0;

	onMount(() => {
		traceWorker = new TraceWorker();
		traceWorker.onmessage = (msg) => {
			const { data } = msg;
			switch (data.type) {
				case 'tracedata':
					const res: ImageTracer.ITraceData = data.data;
					const blackPalettePos = res.palette.findIndex(
						(pal: any) => pal.r === 0 && pal.g === 0 && pal.b === 0 && pal.a === 255
					);
					const blackLayer = res.layers[blackPalettePos];
					if (blackLayer.length > 0) {
						const path = new opentype.Path();
						const boundingbox = blackLayer.reduce(
							(prev, cur) => {
								return [
									prev[0] > cur.boundingbox[0] ? cur.boundingbox[0] : prev[0],
									prev[1] > cur.boundingbox[1] ? cur.boundingbox[1] : prev[1],
									prev[2] < cur.boundingbox[2] ? cur.boundingbox[2] : prev[2],
									prev[3] < cur.boundingbox[3] ? cur.boundingbox[3] : prev[3]
								];
							},
							[...blackLayer[0].boundingbox]
						);
						maxLen = Math.max(
							maxLen,
							boundingbox[2] - boundingbox[0],
							boundingbox[3] - boundingbox[1]
						);

						for (let k = 0; k < blackLayer.length; k++) {
							const segment = blackLayer[k].segments;

							if (blackLayer[k].isholepath) {
								// even-odd 반시계
								for (let l = segment.length - 1; l >= 0; l--) {
									const e = segment[l];
									if (l === segment.length - 1) {
										path.moveTo(e.x2 - boundingbox[0], Math.abs(e.y2 - boundingbox[3]));
									}
									switch (e.type) {
										case 'L':
											path.lineTo(e.x1 - boundingbox[0], Math.abs(e.y1 - boundingbox[3]));
											break;
										case 'Q':
											path.quadTo(
												e.x3 - boundingbox[0],
												Math.abs(e.y3 - boundingbox[3]),
												e.x2 - boundingbox[0],
												Math.abs(e.y2 - boundingbox[3])
											);
											break;
										default:
											break;
									}
									if (l === 0) {
										path.close();
									}
								}
							} else {
								for (let l = 0; l < segment.length; l++) {
									const e = segment[l];
									if (l === 0) {
										path.moveTo(e.x1 - boundingbox[0], Math.abs(e.y1 - boundingbox[3]));
									}
									switch (e.type) {
										case 'L':
											path.lineTo(e.x2 - boundingbox[0], Math.abs(e.y2 - boundingbox[3]));
											break;
										case 'Q':
											path.quadTo(
												e.x2 - boundingbox[0],
												Math.abs(e.y2 - boundingbox[3]),
												e.x3 - boundingbox[0],
												Math.abs(e.y3 - boundingbox[3])
											);
											break;
										default:
											break;
									}
									if (l === segment.length - 1) {
										path.close();
									}
								}
							}
						}

						const glyph = new opentype.Glyph({
							name: data.id.toString(),
							unicode: data.id,
							index: data.pos,
							advanceWidth: boundingbox[2] - boundingbox[0], // 너비
							xMin: 0,
							yMin: 0,
							path
						});
						glyphs.push(glyph);
					}

					comCount++;
					animate({
						from: dashOffset,
						to: (comCount / allCount) * -942.9,
						onUpdate: (i) => (dashOffset = i),
						duration: 10
					});
					console.log('maxlen: ' + maxLen);

					if (allCount === comCount) {
						const font = new opentype.Font({
							familyName: 'Font',
							styleName: 'Medium',
							unitsPerEm: getUnitsPerEm(), // 크기
							ascender: 800,
							descender: -200,
							manufacturer: 'OwnChar',
							glyphs
						});
						console.log('font: ', font);
						dispatch('complete', {
							font
						});
						isProgress = false;
					}
					break;

				default:
					break;
			}
		};
	});

	function trace() {
		if (!isProgress) {
			isProgress = true;
			maxLen = 0;
			allCount = 0;
			comCount = 0;
			const canvas = document.createElement('canvas');
			canvas.width = images[0].data.width;
			canvas.height = images[0].data.height;

			const ctx = canvas.getContext('2d');

			if (ctx !== null) {
				for (let imageI = 0; imageI < images.length; imageI++) {
					const image = images[imageI];
					const qrSplit = image.qr.split('.');
					const page = parseInt(qrSplit[0]);
					let tmp = 0;
					let dataTypes = qrSplit.slice(1, -1).map((detail) => {
						const datas = detail.split('-').map((i) => parseInt(i));
						tmp += datas[2] - datas[1];
						const result = [...datas, tmp];
						return result;
					}); // [type, start, end, count]
					ctx.drawImage(image.data, 0, 0);

					for (let j = 0; j < 11; j++) {
						for (let i = 0; i < 10; i++) {
							const pos = page * 110 + 10 * j + i;
							const dataType = dataTypes.find((i) => i[3] > pos);
							if (dataType !== undefined && (dataType[0] === 0 || dataType[0] === 9)) {
								const fullWidth = ((1000 * image.scale) / 10) * 0.9;
								const data = ctx.getImageData(
									image.x + ((1000 * image.scale) / 10) * (i + 0.05),
									image.y + ((1318 * image.scale) / 11) * (j + 0.28),
									fullWidth,
									((1318 * image.scale) / 11) * 0.68
								);
								allCount++;
								const original: IChar =
									adobekr9[dataType[0] as 0 | 9][pos - dataType[3] + dataType[2]];
								traceImageData(data, original.unicode, 10 * j + i);
							}
						}
					}
				}
			}
		}
	}

	function traceImageData(imageData: ImageData, id: number, pos: number) {
		traceWorker.postMessage({ type: 'trace', data: imageData, id, pos });
	}

	function getUnitsPerEm() {
		let res = [2, 4];
		while (res[1] < maxLen) {
			res[0] = res[1];
			res[1] *= 2;
		}
		const weight = res.map((i) => Math.abs(i - maxLen));
		if (weight[0] < weight[1]) {
			return res[0];
		} else {
			return res[1];
		}
	}
</script>

<div class="container">
	{#if images.length === 0}
		<NoFile />
	{/if}
	<LayersIcon size="50" />
	<h1>Process</h1>
	<p>원을 누르면 폰트로 변환이 시작됩니다.</p>
	<p>해당 작업은 많은 시간이 소요될 수 있습니다.</p>
	<svg viewBox="0 0 400 400" on:click={trace}>
		<text x="190" y="190" class="allText" dominant-baseline="middle">{allCount}</text>
		<circle cx="200" cy="200" r="150" class="backcircle" />
		<circle
			cx="200"
			cy="200"
			r="150"
			class="circle"
			style={`stroke-dashoffset: ${942.9 + dashOffset}`}
		/>
		<circle cx="210" cy="210" r="30" class="outcircle" />
		<circle cx="190" cy="190" r="30" class="incircle" />
		<text x="210" y="210" class="comText" dominant-baseline="middle">{comCount}</text>
	</svg>
</div>

<style lang="scss">
	.container {
		flex-shrink: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		position: relative;
	}

	.circle {
		stroke: #ff9393;
		stroke-width: 10;
		fill: none;
		stroke-linecap: round;
		stroke-dasharray: 942.9;
		stroke-dashoffset: 942.9 - 100;
		transform: rotate(-135deg);
		transform-origin: center;
	}

	.backcircle {
		stroke: #ffcbcb;
		stroke-width: 10;
		fill: none;
	}

	.incircle {
		stroke: #ff9393;
		stroke-width: 3;
		fill: none;
	}

	.outcircle {
		fill: #ff9393;
		stroke: #ff9393;
		stroke-width: 3;
	}

	.allText {
		fill: #ff9393;
		text-anchor: middle;
	}

	.comText {
		fill: white;
		text-anchor: middle;
	}

	svg {
		aspect-ratio: 1/1;
		width: 80%;
		transition: all 0.5s cubic-bezier(0.075, 0.82, 0.165, 1);
		&:hover {
			transform: scale(1.1);
		}
	}

	h1 {
		margin-top: 0;
	}

	p {
		margin: 4px;
	}
</style>
