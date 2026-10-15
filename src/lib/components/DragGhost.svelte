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
	interface Props {
		/** True while the pointer is over the page's actual drop zone. */
		overTarget?: boolean;
	}
	let { overTarget = false }: Props = $props();

	let visible = $state(false);
	let x = $state(0);
	let y = $state(0);
	let vw = $state(0);

	/**
	 * The cat mirrors across the vertical centreline: on the left half it
	 * faces right, on the right half it faces left, so it always looks
	 * inwards instead of out of the viewport — which is what gives the
	 * asymmetric cheek patch on the art somewhere sensible to sit.
	 *
	 * Applied via the `scale` property, not `transform`, because the bob
	 * animation already owns `transform` on this element.
	 */
	const flipped = $derived(vw > 0 && x < vw / 2);

	onMount(() => {
		vw = window.innerWidth;
		const onResize = () => (vw = window.innerWidth);
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
		outer = cursor position, middle = offset + over-target scale, inner = bob.
	-->
	<div
		class="pointer-events-none fixed top-0 left-0 z-[100] will-change-transform"
		style:transform="translate3d({x}px, {y}px, 0)"
		aria-hidden="true"
		inert
	>
		<div
			class="drag-ghost-lift ml-8 mt-8 transition-transform duration-150 ease-out {overTarget
				? 'scale-110'
				: 'scale-100'}"
		>
			<div class="drag-ghost-bob" style:scale={flipped ? '-1 1' : '1 1'}>
				<!--
					Art is the author's own outline cat. The bob lives out here
					rather than inside it, because that artwork animates its mouth
					only — the movement is ours to add, which also keeps the
					component reusable as a plain button elsewhere.
					strokeWidth is scaled up from the art's 130px/10 default to hold
					the same visual weight at 96px, or the outline goes spindly.
				-->
				<PopCat size={96} strokeWidth={14} autoPlay interval={250} sound={false} />
			</div>
		</div>
	</div>
{/if}

<style>
	/*
	 * The bob lives here, not in the cat: PopCat animates its mouth on its own
	 * clock, so a second transform on that component would fight it. Keeping
	 * this on a wrapper keeps the two from colliding.
	 *
	 * Period is 0.5s to match PopCat's 250ms half-cycle, and the peak sits at
	 * 25% so the hop happens while the mouth is open. Peaking at 50% instead
	 * would land the highest point exactly as the mouth snaps shut.
	 */
	@keyframes ghost-bob {
		0%,
		50%,
		100% {
			transform: translateY(0) rotate(-2.5deg);
		}
		25% {
			transform: translateY(-7px) rotate(2.5deg);
		}
	}

	.drag-ghost-bob {
		animation: ghost-bob 0.5s ease-in-out infinite;
		/* The mirror rides on `scale`, which the bob's `transform` never
		   touches, so the two animate independently without fighting. */
		transition: scale 0.18s ease-out;
	}

	@media (prefers-reduced-motion: reduce) {
		/* Keep the cat legible and present, just still. */
		.drag-ghost-bob {
			animation: none;
		}
	}
</style>