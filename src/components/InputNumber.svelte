<script lang="ts">
	export let id: string;
	export let value: any;
	export let step: string;
	export let min: string | undefined = undefined;

	let input: HTMLInputElement;

	function wheel(e: WheelEvent) {
		let weight = e.deltaY > 0 ? -Number(step) : Number(step);
		input.value = (Number(input.value) + weight * (e.shiftKey ? 10 : 1)).toFixed(1);
	}
</script>

<input type="number" {id} {step} {min} on:change bind:value on:wheel={wheel} bind:this={input} />

<style>
	input {
		width: 100%;
		margin-top: auto;
	}
</style>
