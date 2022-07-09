<script lang="ts">
	import { afterUpdate } from 'svelte';

	export let data: ImageBitmap;
	// export let width: number;
	// export let height: number;
	let canvas: HTMLCanvasElement;

	afterUpdate(() => {
		const ctx = canvas.getContext('2d');
		ctx?.drawImage(data, 0, 0);
	});
</script>

<canvas bind:this={canvas} width={data.width} height={data.height} class="canvas" on:click />

<style>
	.canvas {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
