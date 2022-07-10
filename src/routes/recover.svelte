<script lang="ts">
	import opentype from 'opentype.js';
	let inputPdf: FileList;

	function load() {
		inputPdf[0].arrayBuffer().then((buffer) => {
			const font = opentype.parse(buffer);
			const glyphs: opentype.Glyph[] = [];
			for (let i = 0; i < font.glyphs.length; i++) {
				const element = font.glyphs.get(i);
				glyphs.push(element);
			}
			const fixFont = new opentype.Font({
				familyName: 'Font',
				styleName: 'Medium',
				unitsPerEm: font.unitsPerEm,
				ascender: 800,
				descender: -200,
				manufacturer: 'OwnChar',
				glyphs
			});
			console.log(fixFont);
			fixFont.download();
		});
	}
</script>

<input type="file" name="" id="" bind:files={inputPdf} on:change={load} />
