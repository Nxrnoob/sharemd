<script lang="ts">
	import { onMount } from 'svelte';
	import PopCat from './PopCat.svelte';

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

	/** Rendered cat edge length in px. Must match the `size` passed below. */
	const SIZE = 96;
	/** Gap between the pointer and the cat's nearest edge. */
	const GAP = 32;
	/**
	 * Breathing room kept between the cat and the viewport edge. Comfortably
	 * covers the 10% over-target scale (96 -> 105.6), which grows the painted
	 * box by ~4.8px per side while the layout box stays at SIZE.
	 */
	const PAD = 10;

	interface Props {
		/** True while the pointer is over the page's actual drop zone. */
		overTarget?: boolean;
	}
	let { overTarget = false }: Props = $props();

	let visible = $state(false);
	let x = $state(0);
	let y = $state(0);
	let vw = $state(0);
	let vh = $state(0);

	/**
	 * Where the cat sits, decided per-frame from the pointer position.
	 *
	 * It prefers the down-right of the pointer and only moves to the opposite
	 * side when that is what keeps it fully on screen — so dragging into a
	 * corner pushes the cat to the other side of the file rather than letting
	 * half of it slide off. A final clamp catches the case where neither side
	 * fits, which is what happens in a viewport narrower than the cat.
	 *
	 * Facing follows the side the cat actually ended up on, not the side it
	 * started on: the artwork faces left as drawn, so mirroring is applied only
	 * when the cat is trailing on the right and should be looking outward. A cat
	 * on the right that looks left ends up staring back at the file it is
	 * following, which reads as broken.
	 */
	const placement = $derived.by(() => {
		if (vw === 0 || vh === 0) return { left: PAD, top: PAD, flipped: false };

		let left = x + GAP;
		if (left + SIZE + PAD > vw) left = x - GAP - SIZE;

		let top = y + GAP;
		if (top + SIZE + PAD > vh) top = y - GAP - SIZE;

		left = Math.min(Math.max(left, PAD), Math.max(PAD, vw - SIZE - PAD));
		top = Math.min(Math.max(top, PAD), Math.max(PAD, vh - SIZE - PAD));

		return { left, top, flipped: left + SIZE / 2 > x };
	});

	onMount(() => {
		vw = window.innerWidth;
		vh = window.innerHeight;
		const onResize = () => {
			vw = window.innerWidth;
			vh = window.innerHeight;
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

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
		outer = resolved placement, middle = over-target scale, inner = mirror.
		The mirror rides on `scale` rather than `transform` so it stays clear of
		the translate above and the scale below.
	-->
	<div
		class="pointer-events-none fixed top-0 left-0 z-[100] will-change-transform"
		style:transform="translate3d({placement.left}px, {placement.top}px, 0)"
		aria-hidden="true"
		inert
	>
		<div
			class="transition-transform duration-150 ease-out {overTarget
				? 'scale-110'
				: 'scale-100'}"
		>
			<div class="drag-ghost-flip" style:scale={placement.flipped ? '-1 1' : '1 1'}>
				<!--
					Art is the author's own outline cat, used exactly as supplied:
					its mouth-toggle is the only animation, and none is layered on
					top of it here.
					strokeWidth is scaled up from the art's 130px/10 default to hold
					the same visual weight at 96px, or the outline goes spindly.
				-->
				<PopCat size={SIZE} strokeWidth={14} autoPlay interval={250} sound={false} />
			</div>
		</div>
	</div>
{/if}

<style>
	.drag-ghost-flip {
		transition: scale 0.18s ease-out;
	}
</style>