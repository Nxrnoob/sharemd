<script lang="ts">
	import CatMeow from './CatMeow.svelte';

	/**
	 * A cursor-following ghost shown while a file is being dragged over the
	 * window. Self-contained: it owns its own drag listeners so pages just
	 * render `<DragGhost />` and nothing else has to know.
	 *
	 * Deliberately does NOT call `preventDefault()` on its window-level
	 * dragover. The drop zone still owns that, and taking it here would turn
	 * the entire page into a drop target and change where files are accepted.
	 *
	 * Only reacts to drags that actually carry files — dragging selected text
	 * through the page should not summon anything.
	 */
	interface Props {
		/** True while the pointer is over the page's actual drop zone. */
		overTarget?: boolean;
	}
	let { overTarget = false }: Props = $props();

	let visible = $state(false);
	let x = $state(0);
	let y = $state(0);

	function carriesFiles(e: DragEvent): boolean {
		const types = e.dataTransfer?.types;
		if (!types) return false;
		// `types` is a frozen string[] in most browsers, but not all.
		return Array.prototype.indexOf.call(types, 'Files') !== -1;
	}

	function onDragOver(e: DragEvent) {
		if (!carriesFiles(e)) return;
		visible = true;
		x = e.clientX;
		y = e.clientY;
	}

	// Leaving an element bubbles dragleave with a relatedTarget; leaving the
	// window entirely reports null. Only the null case means "drag is over".
	function onDragLeave(e: DragEvent) {
		if (e.relatedTarget === null) visible = false;
	}

	function hide() {
		visible = false;
	}
</script>

<svelte:window ondragover={onDragOver} ondragleave={onDragLeave} ondrop={hide} ondragend={hide} />

{#if visible}
	<!--
		Three layers so nothing fights over `transform`:
		outer = cursor position, middle = offset + over-target scale, inner = bob.
	-->
	<div
		class="pointer-events-none fixed top-0 left-0 z-[100] will-change-transform"
		style:transform="translate3d({x}px, {y}px, 0)"
		aria-hidden="true"
	>
		<div
			class="drag-ghost-lift ml-4 mt-4 transition-transform duration-150 ease-out {overTarget
				? 'scale-110'
				: 'scale-100'}"
		>
			<div
				class="drag-ghost-cat"
			>
				<!--
					Recreated as vector geometry rather than traced from the
					reference photo: the cat's fur and the wall behind it sit in
					the same brightness band, so no cutout is possible from those
					pixels. Drawn, it is clean at any size and inherits the theme.
				-->
				<CatMeow size={72} />
			</div>
		</div>
	</div>
{/if}

<style>
	/*
	 * No animation lives here any more. The cursor position is applied to the
	 * outer element via `transform`, and the bob + meow belong to the cat
	 * itself so they stay in sync — see CatMeow.svelte.
	 */
</style>