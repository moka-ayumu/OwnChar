<script lang="ts">
	import { animate } from 'popmotion';
	
	import type { IImages } from 'src/types/Types';
	import FileLoad from '../tabs/FileLoad.svelte';
	import ImageView from '../tabs/ImageView.svelte';
	import Process from '../tabs/Process.svelte';
	import FontEdit from '../tabs/FontEdit.svelte';
	import { ChevronLeftIcon, ChevronRightIcon } from 'svelte-feather-icons';
	let images: IImages[] = [];
	let font: opentype.Font | undefined = undefined;

	let posTab = 0;

	function nextTab(i = 1) {
		if (!(posTab + i > 3)) {
			posTab += i;
			moveTab();
		}
	}

	function prevTab() {
		if (!(posTab - 1 < 0)) {
			posTab--;
			moveTab();
		}
	}

	let tabLeft = 0;
	function moveTab() {
		animate({
			from: tabLeft,
			to: posTab * -100,
			onUpdate: (i) => (tabLeft = i),
			duration: 300
		});
	}
</script>

<div class="container">
	<button type="button" on:click={prevTab} class="tabButton leftBtn" disabled={posTab === 0}>
		<ChevronLeftIcon size="60" />
	</button>
	<div>
		<div style={`margin-left: ${tabLeft}%`} />
		<FileLoad
			bind:images
			bind:font
			on:complete={({ detail: { type } }) => (type === 'zip' ? nextTab() : nextTab(3))}
		/>
		<ImageView bind:images />
		<Process
			bind:images
			on:complete={(e) => {
				font = e.detail.font;
				nextTab();
			}}
		/>
		<FontEdit bind:font />
	</div>
	<button
		type="button"
		on:click={() => nextTab()}
		class="tabButton rightBtn"
		disabled={posTab === 3}
	>
		<ChevronRightIcon size="60" />
	</button>
</div>
<p class="top center title">OwnChar</p>
<p class="bottom center" style={`opacity: ${posTab === 0 ? 1 : 0}`}>
	본 사이트는 크롬에 맞춰 제작되었습니다.
</p>
<a
	class="bottomRight"
	style={`opacity: ${posTab === 0 ? 1 : 0}`}
	href="/license"
	target="_blank"
	rel="noopener noreferrer">License</a
>

<style lang="scss">
	:root {
		// background-color: #fff0f0;
		background-image: url('/background.jpg');
		background-position: center;
		background-origin: content-box;
		background-size: cover;
		height: 100vh;
	}

	.container {
		display: flex;
		width: 90vw;
		height: 90vh;
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		& > div {
			flex: 1;
			display: flex;
			overflow: hidden;
			border-radius: 30px;
		}
	}

	.tabButton {
		width: 80px;
		height: 80px;
		margin: auto;
		border-radius: 60%;
		border: none;
		font-size: 40px;
		background-color: #ffeffa00;
		display: flex;
		align-items: center;
		justify-content: center;
		position: absolute;
		z-index: 1000;
		margin: 0;
		transition: all 0.3s cubic-bezier(0.075, 0.82, 0.165, 1);
		top: 50%;
		transform: translateY(-50%);
	}

	.leftBtn {
		left: 0;
		&:hover:enabled {
			margin-left: 10px;
			&:active {
				margin-left: 20px;
			}
		}
	}

	.rightBtn {
		right: 0;
		&:hover:enabled {
			margin-right: 10px;
			&:active {
				margin-right: 20px;
			}
		}
	}

	.top {
		position: absolute;
		top: 30px;
	}

	.bottom {
		position: absolute;
		bottom: 30px;
		transition: opacity 0.3s cubic-bezier(0.075, 0.82, 0.165, 1);
		opacity: 0;
	}

	.center {
		margin: 0;
		left: 50%;
		transform: translateX(-50%);
	}

	.bottomRight {
		position: absolute;
		bottom: 30px;
		right: 60px;
		transition: opacity 0.3s cubic-bezier(0.075, 0.82, 0.165, 1);
		opacity: 0;
		text-decoration: none;
		color: black;
	}

	.title {
		font-size: 30px;
		font-weight: 600;
		opacity: 0.7;
		pointer-events: none;
	}
</style>
