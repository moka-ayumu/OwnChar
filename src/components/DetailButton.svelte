<script lang="ts">
	export let title = '';
	export let disabled = false;
</script>

<button on:click {disabled}>
	{title}
	<div><slot /></div>
</button>

<style lang="scss">
	button {
		position: relative;
		overflow: hidden;
		background-color: #ffffff;
		border: none;
		border-radius: 10px;
		padding: 10px;
		transition: all 0.5s cubic-bezier(0.075, 0.82, 0.165, 1);
		div {
			transition: all 0.5s cubic-bezier(0.075, 0.82, 0.165, 1);
			border-radius: 10px;
			width: 100%;
			position: absolute;
			top: 0%;
			left: 0;
			margin: 0;
			z-index: 10;
			background-color: #ffffff;
			opacity: 0;
		}

		&:hover {
			overflow: visible;
			background-color: #ffd4d4;
			div {
				top: 100%;
				opacity: 1;
			}
		}
		&:active {
			background-color: #ffa9a9;
			// transform: translateY(10px);
		}
	}
</style>
