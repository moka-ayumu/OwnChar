<script lang="ts">
	// import opentype from 'opentype.js';
	import { afterUpdate } from 'svelte';

	export let glyph: opentype.Glyph;
	let root: HTMLDivElement;
	let svg: SVGElement;

	afterUpdate(() => {
		const path = glyph.getPath(0, 0, 60).toDOMElement(2);
		let d = path.getAttribute('d');
		if (d !== null) {
			d = d.replace(/-/g, ' ');
			path.setAttribute('d', d);
			path.setAttribute('transform', 'scale(1, -1) translate(0, -100)');
			if (svg.firstChild === null) {
				svg.appendChild(path);
			} else {
				svg.replaceChild(svg.firstChild, path);
			}
		}
	});
</script>

<div bind:this={root}>
	<svg bind:this={svg} />
</div>

<style>
	svg {
		width: 100px;
		height: 100px;
	}
</style>
