<script lang="ts">
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
			<div class="drag-ghost-bob">
				<!--
					Placeholder for the cat art. Monochrome is applied here rather
					than at the call site so the real artwork inherits it for free.
				-->
				<div
					class="flex size-20 items-center justify-center rounded-full border border-dashed border-ink-soft/50 bg-ink-soft/10 opacity-80"
				>
					<svg
						class="size-7 text-ink-soft"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<ellipse cx="6.2" cy="10.4" rx="2.1" ry="2.6" />
						<ellipse cx="10.2" cy="7.4" rx="2" ry="2.5" />
						<ellipse cx="14.6" cy="7.9" rx="2" ry="2.4" />
						<ellipse cx="18.1" cy="11.4" rx="1.9" ry="2.3" />
						<path
							d="M12.2 12.4c2.5 0 4.9 1.9 4.9 4.1 0 1.7-1.5 2.6-3.2 2.4a5.6 5.6 0 0 0-3.4 0c-1.7.2-3.2-.7-3.2-2.4 0-2.2 2.4-4.1 4.9-4.1Z"
						/>
					</svg>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/*
	 * The bob. Kept on its own element because the parent already owns
	 * `transform` for cursor positioning, and one property cannot serve both.
	 * The two-phase ease gives the small settle at the top of each hop.
	 */
	@keyframes ghost-bob {
		0%,
		100% {
			transform: translateY(0) rotate(-2.5deg);
		}
		50% {
			transform: translateY(-7px) rotate(2.5deg);
		}
	}

	.drag-ghost-bob {
		animation: ghost-bob 0.85s ease-in-out infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		/* Keep it legible and present, just still. */
		.drag-ghost-bob {
			animation: none;
		}
	}
</style>