<script lang="ts">
	import type { IImages } from 'src/types/Types';
	import { beforeUpdate, onMount } from 'svelte';
	import { SettingsIcon } from 'svelte-feather-icons';

	import Bitmap from '../components/Bitmap.svelte';
	import NoFile from '../components/NoFile.svelte';

	export let images: IImages[];
	let selectedData: IImages;

	let canvasSetDetail: HTMLCanvasElement;
	let loaded = false;
	let isGlobal = true;
	// let scale: number = 1;
	// let x: number = 20;
	// let y: number = 120;

	onMount(() => {});

	beforeUpdate(() => {
		// console.log(images);
		if (images.length > 0 && selectedData === undefined) {
			selectedData = images[0];
		}
		if (canvasSetDetail !== undefined && !loaded) {
			settingUpdate();
			loaded = true;
		}
	});

	function settingUpdate() {
		const ctx = canvasSetDetail.getContext('2d');
		if (ctx !== null) {
			ctx.clearRect(0, 0, canvasSetDetail.width, canvasSetDetail.height);
			ctx.fillStyle = '#40404022';
			ctx.fillRect(0, 0, canvasSetDetail.width, canvasSetDetail.height);
			ctx.strokeStyle = '#ff4d4d';
			ctx.lineWidth = 5;
			ctx.strokeRect(
				selectedData.x,
				selectedData.y,
				1000 * selectedData.scale,
				1318 * selectedData.scale
			);

			for (let i = 0; i < 10; i++) {
				for (let j = 0; j < 11; j++) {
					ctx.strokeStyle = '#44a4f2';
					ctx.strokeRect(
						selectedData.x + ((1000 * selectedData.scale) / 10) * (i + 0.05),
						selectedData.y + ((1318 * selectedData.scale) / 11) * (j + 0.28),
						((1000 * selectedData.scale) / 10) * 0.9,
						((1318 * selectedData.scale) / 11) * 0.68
					);
				}
			}
		}
	}

	function onMouseMove(e: MouseEvent) {
		if (e.buttons === 1) {
			selectedData.x += e.movementX * (e.shiftKey ? 0.1 : 4);
			selectedData.y += e.movementY * (e.shiftKey ? 0.1 : 4);
			if (isGlobal) {
				for (let i = 0; i < images.length; i++) {
					const data = images[i];
					data.x = selectedData.x;
					data.y = selectedData.y;
				}
			}
			settingUpdate();
		}
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		selectedData.scale -= e.deltaY * (e.shiftKey ? 0.00003 : 0.0003);
		if (selectedData.scale < 0) selectedData.scale = 0;
		if (isGlobal) {
			for (let i = 0; i < images.length; i++) {
				const data = images[i];
				data.scale = selectedData.scale;
			}
		}
		settingUpdate();
	}
</script>

<div class="container">
	{#if images.length === 0}
		<NoFile />
	{/if}
	<div>
		<div class="list">
			<!-- 이미지들 -->
			{#each images as data}
				<div class:selected={data === selectedData}>
					<Bitmap
						data={data.data}
						on:click={() => {
							selectedData = data;
							settingUpdate();
						}}
					/>
				</div>
			{/each}
		</div>
		{#if selectedData !== undefined}
			<div class="viewer">
				<!-- 이미지 -->
				<canvas
					width={selectedData.data.width}
					height={selectedData.data.height}
					bind:this={canvasSetDetail}
					class="canvasSetDetail"
					on:mousemove={onMouseMove}
					on:wheel={onWheel}
				/>
				<div>
					<Bitmap data={selectedData.data} />
				</div>
			</div>
			<div class="settings">
				<h2><SettingsIcon size="20" />설정</h2>
				<p>빨간색 사각형을 제일 큰 사각형에 맞춰주세요</p>
				<div>
					<p>드래그: 이동</p>
					<p>스크롤: 크기 조정</p>
					<p>쉬프트키 입력시 더 느리게 조정</p>
				</div>
				<div>
					<label for="global">모든 페이지 동기화</label>
					<input type="checkbox" id="global" bind:checked={isGlobal} />
				</div>
				<div>
					<label for="scale">크기</label>
					<input
						type="number"
						on:change={settingUpdate}
						bind:value={selectedData.scale}
						id="scale"
						step="0.1"
					/>
				</div>
				<div>
					<label for="x">X 좌표</label>
					<input
						type="number"
						on:change={settingUpdate}
						bind:value={selectedData.x}
						id="x"
						step="1"
					/>
				</div>
				<div>
					<label for="y">Y 좌표</label>
					<input
						type="number"
						on:change={settingUpdate}
						bind:value={selectedData.y}
						id="y"
						step="1"
					/>
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
		align-items: center;
		justify-content: center;
		position: relative;
		& > div {
			display: flex;
			height: 100%;
			gap: 10px;
			align-items: center;
			justify-content: center;
		}
	}

	.list {
		width: 10%;
		height: 100%;
		overflow-y: scroll;
		background-color: white;
		padding: 10px;
		box-sizing: border-box;
		border-radius: 10px;
		margin-left: auto;
		& > div {
			margin: 10px;
			transition: all 0.5s cubic-bezier(0.19, 1, 0.22, 1);
		}
	}

	.viewer {
		position: relative;
		width: 42%;
		height: 100%;
		& > * {
			position: absolute;
			left: 0;
			top: 0;
			width: 100%;
			height: 100%;
		}
	}

	.canvasSetDetail {
		z-index: 10;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.selected {
		box-shadow: 0px 0px 10px rgb(238, 83, 83);
	}

	.settings {
		width: 10%;
		display: flex;
		flex-direction: column;
		gap: 20px;
		background-color: white;
		padding: 60px 30px;
		border-radius: 20px;
		// height: 80%;
		margin-right: auto;
		align-items: center;
		justify-content: center;
		& > div {
			display: flex;
			flex-direction: column;
			gap: 5px;
			align-items: center;
			justify-content: center;
		}
	}

	p {
		margin: 0;
	}

	h2 {
		display: flex;
		gap: 5px;
		align-items: center;
		width: 100%;
		padding-bottom: 10px;
		border-bottom: 1px solid black;
		margin: 0;
	}

	input {
		width: 100%;
	}
</style>
