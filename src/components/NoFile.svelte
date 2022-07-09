<script lang="ts">
	import { AlertCircleIcon } from 'svelte-feather-icons';
</script>

<div class="noFile">
	<AlertCircleIcon size="50" class="alert" />
	<p>먼저 <span>파일</span>을 업로드해주세요</p>
</div>

<style lang="scss">
	:global(.alert) {
		stroke: rgb(201, 74, 74);
	}

	.noFile {
		position: absolute;
		left: 0;
		top: 0;
		width: 100%;
		height: 100%;
		background-color: #afafaf75;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(10px);
		z-index: 100;
		& > p {
			font-size: 25px;
			margin: 10px;
			& > span {
				font-weight: 700;
				color: rgb(201, 74, 74);
				font-size: 30px;
			}
		}
	}
</style>
