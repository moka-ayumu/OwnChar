<script lang="ts">
	import type opentype from 'opentype.js';
	import { animate } from 'popmotion';
	import type { IGlyph } from 'src/types/Types';
	import { afterUpdate } from 'svelte';
	import { ArrowLeftIcon, ArrowRightIcon, EditIcon } from 'svelte-feather-icons';
	import DetailButton from '../components/DetailButton.svelte';
	import NoFile from '../components/NoFile.svelte';
	// import Glyph from './Glyph.svelte';

	export let font: opentype.Font | undefined;
	let prevFont: opentype.Font | undefined;
	let glyphs: IGlyph[] = [];
	let prevFontFace: FontFace | undefined = undefined;
	let exampleArea: HTMLTextAreaElement;
	let selectedGlyph: IGlyph | undefined = undefined;
	let glyphTab = 0;
	let glyphFullTab = 0;
	let countPerTab = 101;
	let margin = {
		left: Number.MAX_VALUE,
		right: Number.MAX_VALUE,
		y: Number.MAX_VALUE
	};

	afterUpdate(() => {
		if (font !== undefined) {
			if (prevFont === undefined || prevFont !== font) {
				prevFont = font;
				glyphFullTab = Math.ceil((font.glyphs.length - 1) / countPerTab) - 1;
				console.log('glyphFullTab: ', glyphFullTab);
				glyphs = [];
				for (let i = 0; i < font.glyphs.length; i++) {
					const glyph = font.glyphs.get(i);
					if (glyph.unicode !== undefined && glyph.unicode !== 0) {
						const data = {
							glyph,
							left: glyph.getBoundingBox().x1,
							right: glyph.advanceWidth - glyph.getBoundingBox().x2,
							y: glyph.getMetrics().yMin,
							scale: 1,
							prevScale: 1,
							rotate: 0,
							prevRotate: 0
						};
						glyphs.push(data);
						margin.left = Math.min(margin.left, data.left);
						margin.right = Math.min(margin.right, data.right);
						margin.y = Math.min(margin.y, data.y);
					}
				}
				for (let i = 0; i < glyphs.length; i++) {
					glyphs[i].left -= margin.left;
					glyphs[i].right -= margin.right;
					glyphs[i].y -= margin.y;
				}
				glyphs.sort((a, b) => a.glyph.unicode - b.glyph.unicode);
				selectedGlyph = glyphs[0];
				// changeGlyphTab();

				const arrayBuffer = font.toArrayBuffer();
				if (prevFontFace !== undefined) {
					(document.fonts as any).delete(prevFontFace);
				}
				prevFontFace = new FontFace('test', arrayBuffer);
				prevFontFace.load().then((f) => {
					(document.fonts as any).add(f);
					exampleArea.style.fontFamily = 'test';
				});
			}
		}
	});

	function changeGlyphTab() {
		if (font !== undefined) {
			glyphs = [];
			const pos = glyphTab * countPerTab;
			const end = glyphTab === glyphFullTab ? font.glyphs.length : pos + countPerTab;
			for (let i = pos; i < end; i++) {
				const glyph = font.glyphs.get(i);
				if (glyph.unicode !== undefined && glyph.unicode !== 0) {
					glyphs.push({
						glyph,
						left: glyph.getBoundingBox().x1,
						right: glyph.getMetrics().xMax - glyph.getMetrics().xMin - glyph.getBoundingBox().x2,
						y: glyph.getMetrics().yMin,
						scale: 1,
						prevScale: 1,
						rotate: 0,
						prevRotate: 0
					});
				}
			}
			glyphs.sort((a, b) => a.glyph.unicode - b.glyph.unicode);
			selectedGlyph = glyphs[0];
		}
	}

	function toAllSqure() {
		const len = glyphs.reduce((prev, cur) => {
			const boundingBox = cur.glyph.getBoundingBox();
			return Math.max(prev, boundingBox.x2 - boundingBox.x1, boundingBox.y2 - boundingBox.y1);
		}, 0);
		for (let i = 0; i < glyphs.length; i++) {
			toSquare(glyphs[i], len);
		}
		updateGlyph(true);
		selectedGlyph = selectedGlyph;
	}

	function toSquare(data: IGlyph, len: number) {
		const boundingBox = data.glyph.getBoundingBox();
		const origianlY = boundingBox.y2 - boundingBox.y1;
		data.y = (len - origianlY) / 2;
		const originalX = boundingBox.x2 - boundingBox.x1;
		data.left = (len - originalX) / 2;
		data.right = data.left;
	}

	function allReset() {
		for (let i = 0; i < glyphs.length; i++) {
			reset(glyphs[i]);
		}
		margin.left = 0;
		margin.right = 0;
		margin.y = 0;
		updateGlyph(true);
		selectedGlyph = selectedGlyph;
	}

	function reset(data: IGlyph) {
		data.left = 0;
		data.prevScale = 1;
		data.scale = 1;
		data.right = 0;
		data.y = 0;
		data.prevRotate = 0;
		data.rotate = 0;
	}

	function updateGlyph(all = false) {
		if (font !== undefined) {
			console.log(font);
			const list = all ? glyphs : selectedGlyph === undefined ? [] : [selectedGlyph];
			for (let i = 0; i < list.length; i++) {
				const glyph = list[i];
				if (glyph.scale <= 0 || glyph.scale === undefined) glyph.scale = glyph.prevScale;

				const path = glyph.glyph.path as opentype.Path;
				let boundingBox = glyph.glyph.getBoundingBox();
				const weightLeft = margin.left + glyph.left - boundingBox.x1;
				const weightY = margin.y + glyph.y - boundingBox.y1;
				const weightScale = Math.pow(glyph.prevScale, -1) * glyph.scale;
				const weightRotate = ((glyph.rotate - glyph.prevRotate) * Math.PI) / 180;
				const cos = Math.cos(weightRotate);
				const sin = Math.sin(weightRotate);
				glyph.prevScale = glyph.scale;
				glyph.prevRotate = glyph.rotate;
				const center: [number, number] = [(boundingBox.x2 + boundingBox.x1) / 2, (boundingBox.y2 + boundingBox.y1) / 2];
				for (let i = 0; i < path.commands.length; i++) {
					const command = path.commands[i] as any;
					if (command.hasOwnProperty('x')) [command.x, command.y] = transform(command.x, command.y, center, weightLeft, weightY, weightScale, cos, sin);
					if (command.hasOwnProperty('x1')) [command.x1, command.y1] = transform(command.x1, command.y1, center, weightLeft, weightY, weightScale, cos, sin);
					if (command.hasOwnProperty('x2')) [command.x2, command.y2] = transform(command.x2, command.y2, center, weightLeft, weightY, weightScale, cos, sin);
				}
				boundingBox = glyph.glyph.getBoundingBox();
				glyph.glyph.advanceWidth = boundingBox.x2 - boundingBox.x1 + margin.left + glyph.left + margin.right + glyph.right;
			}
			selectedGlyph = selectedGlyph;

			const arrayBuffer = font.toArrayBuffer();
			if (prevFontFace !== undefined) {
				(document.fonts as any).delete(prevFontFace);
			}
			prevFontFace = new FontFace('test', arrayBuffer);
			prevFontFace.load().then((f) => {
				(document.fonts as any).add(f);
			});
		}
	}

	function transform(x: number, y: number, center: [number, number], left: number, up: number, scale: number, cos: number, sin: number) {
		let newX = (x - center[0]) * scale;
		let newY = (y - center[1]) * scale;

		x = newX * cos - newY * sin;
		x += center[0];
		x += left;

		y = newX * sin + newY * cos;
		y += center[1];
		y += up;
		return [x, y];
	}

	function applyName() {
		if (font !== undefined) {
			const { names } = font;
			names.fontFamily.en = names.fontFamily.en.replace(/[^a-z0-9\s]/gi, '');
			names.fontSubfamily.en = names.fontSubfamily.en.replace(/[^a-z0-9\s]/gi, '');
			font = font;
			names.fullName.en = `${names.fontFamily.en} ${names.fontSubfamily.en}`;
			names.postScriptName.en = `${names.fontFamily.en}${names.fontSubfamily.en}`;
		}
	}

	let search = '';
	let tabLeft = 0;

	function tab(n: number) {
		animate({
			from: tabLeft,
			to: n * -100,
			onUpdate: (i) => (tabLeft = i),
			duration: 300
		});
	}

	function textareaOnSelect(e: Event) {
		const textarea = e.target as HTMLTextAreaElement;
		if (textarea.textContent !== null) {
			const charCode = textarea.value.charCodeAt(textarea.selectionStart);
			const find = glyphs.find(({ glyph }) => glyph.unicode === charCode);
			if (find !== undefined) selectedGlyph = find;
		}
	}

	$: searchGlyph = search === '' ? glyphs : [glyphs.find((glyph) => glyph.glyph.unicode === search.charCodeAt(0))];
</script>

<div class="container">
	{#if font === undefined}
		<NoFile />
	{/if}
	<div>
		<h2><EditIcon size="30" />편집</h2>
		<textarea bind:this={exampleArea} class="exampleArea testFont" placeholder="직접 폰트를 사용해보세요!" on:select={textareaOnSelect} />
		<div class="buttons">
			<DetailButton title="모두 정사각형으로" on:click={toAllSqure}>
				<p>모든 글자에 적당한 여백을 넣어 똑같은 크기로 만듭니다</p>
			</DetailButton>
			<DetailButton title="초기화" on:click={allReset}>
				<p class="wordSafe">모든 설정값을 초기화 합니다</p>
			</DetailButton>
			<DetailButton title="폰트 다운로드" on:click={() => font?.download()}>
				<p class="wordSafe">작업한 폰트를 저장합니다</p>
			</DetailButton>
			<p style="margin-left: auto">드래그 한 첫부분의 문자가 선택됩니다.</p>
		</div>
		<div>
			<button on:click={() => tab(0)}>세부사항</button>
			<button on:click={() => tab(1)}>글자들</button>
		</div>
		{#if font !== undefined}
			<div class="detail">
				<div class="names" style={`margin-left: ${tabLeft}%;`}>
					<div>
						<div>
							<label for="fontFamilyEn">이름(영어)</label>
							<input type="text" id="fontFamilyEn" bind:value={font.names.fontFamily.en} on:change={applyName} />
						</div>
						<div>
							<label for="fontFamilyKo">이름(한국어)</label>
							<input type="text" id="fontFamilyKo" bind:value={font.names.fontFamily.ko} on:change={applyName} />
						</div>
						<div>
							<label for="fontSubfamily">유형</label>
							<input type="text" id="fontSubfamily" bind:value={font.names.fontSubfamily.en} on:change={applyName} />
						</div>
						<!-- <div>
							<label for="description">설명</label>
							<input type="text" id="description" bind:value={font.names.description.en} />
						</div> -->
						<div>
							<label for="designerEn">제작자(영어)</label>
							<input type="text" id="designerEn" bind:value={font.names.designer.en} />
						</div>
						<div>
							<label for="designerKo">제작자(한국어)</label>
							<input type="text" id="designerKo" bind:value={font.names.designer.ko} />
						</div>
						<!-- <div>
							<label for="designerURL">제작자 주소</label>
							<input type="text" id="designerURL" bind:value={font.names.designerURL.en} />
						</div> -->
						<div>
							<label for="version">버전</label>
							<input type="text" id="version" bind:value={font.names.version.en} />
						</div>
					</div>
				</div>
				<div class="glyphsSetting">
					<div class="glyphsLeft">
						<div class="search">
							<input type="text" bind:value={search} maxlength="1" id="saerch" placeholder="검색어" />
						</div>
						<div class="glyphs">
							{#each searchGlyph as glyph}
								<!-- <Glyph {glyph} /> -->
								{#if glyph !== undefined}
									<div class="glyph" class:glyphSelected={selectedGlyph === glyph} on:click={() => (selectedGlyph = glyph)}>
										<p class="testFont">
											{String.fromCharCode(glyph.glyph.unicode)}
										</p>
									</div>
								{/if}
							{/each}
						</div>
						<!-- <div class="glyphTabButton">
							<button
								disabled={glyphTab === 0}
								on:click={() => {
									glyphTab--;
									changeGlyphTab();
								}}><ArrowLeftIcon /></button
							>
							<button
								disabled={glyphTab === glyphFullTab}
								on:click={() => {
									glyphTab++;
									changeGlyphTab();
								}}><ArrowRightIcon /></button
							>
						</div> -->
					</div>
					<div class="vert" />
					<div class="settings">
						{#if selectedGlyph !== undefined}
							<h3>전체</h3>
							<div>
								<div>
									<label class="wordSafe" for="marginLeft">왼쪽 여백</label>
									<input type="number" id="marginLeft" step="0.1" bind:value={margin.left} on:change={() => updateGlyph(true)} />
								</div>
								<div>
									<label class="wordSafe" for="marginRight">오른쪽 여백</label>
									<input type="number" id="marginRight" step="0.1" bind:value={margin.right} on:change={() => updateGlyph(true)} />
								</div>
								<div>
									<label for="marginY">높이</label>
									<input type="number" id="marginY" bind:value={margin.y} on:change={() => updateGlyph(true)} />
								</div>
							</div>
							<div class="hori" />
							<div class="preview">
								<p class="testFont">
									{String.fromCharCode(selectedGlyph.glyph.unicode)}
								</p>
								<div class="previewTop" />
								<div class="previewLeft" style={`width: ${(margin.left + selectedGlyph.left) * 0.614}px`}>
									<p>{margin.left + selectedGlyph.left}</p>
									<div />
								</div>
								<div class="previewRight" style={`width: ${(margin.right + selectedGlyph.right) * 0.614}px`}>
									<p>{margin.right + selectedGlyph.right}</p>
									<div />
								</div>
								<div class="previewY" style={`height: ${(margin.y + selectedGlyph.y) * 0.614}px`}>
									<p>{margin.y + selectedGlyph.y}</p>
									<div />
								</div>
							</div>
							<div>
								<div>
									<p class="wordSafe" style="font-weight: 600">기준 문자</p>
									<p>{String.fromCharCode(selectedGlyph.glyph.unicode)}</p>
								</div>
								<div>
									<p class="wordSafe" style="font-weight: 600">가로 길이</p>
									<p class="wordBreak">{selectedGlyph.glyph.advanceWidth}</p>
								</div>
							</div>
							<div>
								<div>
									<label class="wordSafe" for="left">왼쪽 여백</label>
									<input type="number" id="left" step="0.1" bind:value={selectedGlyph.left} on:change={() => updateGlyph()} />
								</div>
								<div>
									<label class="wordSafe" for="right">오른쪽 여백</label>
									<input type="number" id="right" step="0.1" bind:value={selectedGlyph.right} on:change={() => updateGlyph()} />
								</div>
								<div>
									<label for="y">높이</label>
									<input type="number" id="y" bind:value={selectedGlyph.y} on:change={() => updateGlyph()} />
								</div>
							</div>
							<div>
								<div>
									<label for="scale">크기</label>
									<input type="number" id="scale" step="0.05" min="0.1" bind:value={selectedGlyph.scale} on:change={() => updateGlyph()} />
								</div>
								<div>
									<label for="rotate">회전</label>
									<input type="number" id="rotate" step="1" bind:value={selectedGlyph.rotate} on:change={() => updateGlyph()} />
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style lang="scss">
	.container {
		display: flex;
		flex-shrink: 0;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
		position: relative;
		& > div {
			width: 80%;
			height: 100%;
			display: flex;
			flex-direction: column;
			gap: 10px;
		}
	}

	.buttons {
		display: flex;
		gap: 5px;
		align-items: center;
		& > p {
			margin: 0;
		}
	}

	.testFont {
		font-family: 'test';
	}

	.detail {
		display: flex;
		width: 100%;
		height: 100%;
		overflow: hidden;
		& > div {
			display: flex;
			width: 100%;
			flex-shrink: 0;
		}
	}

	.glyphsSetting {
		gap: 10px;
	}

	.glyphs {
		width: 100%;
		display: flex;
		flex-wrap: wrap;
		height: 100%;
		gap: 5px;
		align-content: flex-start;
		overflow-y: auto;
	}

	.vert {
		border-left: 3px solid rgb(255, 195, 195);
	}

	.hori {
		border-top: 3px solid rgb(255, 195, 195);
		width: 100%;
	}

	.exampleArea {
		font-size: 50px;
		padding: 30px 20px;
		border-radius: 20px;
		width: 100%;
		box-sizing: border-box;
		resize: none;
	}

	h2 {
		display: flex;
		gap: 10px;
		align-items: center;
		width: 100%;
		padding-bottom: 10px;
		border-bottom: 1px solid black;
	}

	.settings {
		display: flex;
		flex-direction: column;
		background-color: white;
		border-radius: 30px;
		padding: 30px 20px;
		justify-content: center;
		align-items: center;
		justify-items: center;
		gap: 20px;
		overflow: auto;

		& > div {
			display: flex;
			gap: 10px;
			& > div {
				display: flex;
				flex-direction: column;
				gap: 10px;
			}
		}

		input {
			width: 100%;
			margin-top: auto;
		}

		p {
			margin: 0;
			text-align: center;
		}

		label {
			font-weight: 600;
			text-align: center;
		}
	}

	.preview {
		// width: 100%;
		position: relative;
		& > .testFont {
			font-size: 80px;
			text-align: center;
			z-index: 10;
		}
		& > .previewLeft {
			position: absolute;
			left: 0;
			top: 50%;
			transform: translateY(-50%);
			font-size: 10px;
			font-weight: 200;
			height: 40%;
			border-left: 2px solid #6d6d6d;
			& > p {
				margin: auto;
				position: relative;
				background-color: #ffffff;
				padding: 2px;
			}
			& > div {
				position: absolute;
				width: 100%;
				border-top: 2px solid #6d6d6d;
				left: 0;
				top: 50%;
				transform: translateY(-50%);
				z-index: -1;
			}
		}
		& > .previewRight {
			position: absolute;
			right: 0;
			top: 50%;
			transform: translateY(-50%);
			font-size: 10px;
			font-weight: 200;
			height: 40%;
			border-right: 2px solid #6d6d6d;
			& > p {
				margin: auto;
				position: relative;
				background-color: #ffffff;
				padding: 2px;
			}
			& > div {
				position: absolute;
				width: 100%;
				border-top: 2px solid #6d6d6d;
				right: 0;
				top: 50%;
				transform: translateY(-50%);
				z-index: -1;
			}
		}
		& > .previewY {
			position: absolute;
			left: 50%;
			bottom: 7px;
			transform: translateX(-50%);
			font-size: 10px;
			font-weight: 200;
			width: 40%;
			border-bottom: 2px solid #6d6d6d;
			& > p {
				margin: auto;
				position: relative;
				background-color: #ffffff;
				padding: 2px;
			}
			& > div {
				position: absolute;
				height: 100%;
				border-left: 2px solid #6d6d6d;
				bottom: 0;
				left: 50%;
				transform: translateX(-50%);
				z-index: -1;
			}
		}
		& > .previewTop {
			position: absolute;
			top: 0;
			left: 50%;
			transform: translateX(-50%);
			width: 40%;
			border-top: 2px solid #6d6d6d;
		}
	}

	.glyph {
		background-color: #ffffff;
		border-radius: 20px;
		// box-shadow: 3px 3px 0px -1px rgb(90, 90, 90);
		transition: all 0.5s cubic-bezier(0.075, 0.82, 0.165, 1);
		width: 50px;
		height: 50px;
		display: flex;
		& > p {
			margin: auto;
		}

		&:hover {
			background-color: #ffdede;
		}
	}

	.glyphSelected {
		background-color: #ffdede;
	}

	.search {
		width: 100%;
		display: flex;
		& > input {
			margin-left: auto;
			width: 50px;
		}
	}

	.wordSafe {
		word-break: keep-all;
	}

	.wordBreak {
		word-break: break-all;
	}

	.names {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		& > div {
			margin: auto;
			display: flex;
			flex-direction: column;
			gap: 10px;

			& > div {
				display: flex;
				gap: 10px;
				align-items: center;
				font-size: 20px;

				& > label {
					font-weight: 300;
					margin-left: auto;
					flex-shrink: 0;
				}

				& > input {
					max-width: 250px;
					width: 100%;
				}
			}
		}
	}

	.glyphsLeft {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		width: 70%;
	}

	h3 {
		margin: 0;
	}

	// .glyphTabButton {
	// 	display: flex;
	// 	justify-content: center;
	// }
</style>
