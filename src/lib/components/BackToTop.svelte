<script lang="ts">
	import { onMount } from 'svelte';

	const SHOW_AFTER = 600;

	let visible = $state(false);

	function scrollTop() {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
	}

	onMount(() => {
		let raf = 0;
		const measure = () => {
			raf = 0;
			// Only on pages that actually scroll. Compare-then-bail: scroll
			// frames that change nothing must not churn state.
			const scrollable = document.documentElement.scrollHeight > window.innerHeight + 40;
			const next = scrollable && window.scrollY > SHOW_AFTER;
			if (visible !== next) visible = next;
		};
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(measure);
		};
		measure();
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		return () => {
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			if (raf) cancelAnimationFrame(raf);
		};
	});
</script>

{#if visible}
	<button
		type="button"
		onclick={scrollTop}
		aria-label="Back to top"
		title="Back to top"
		class="fixed right-4 bottom-5 z-40 grid size-11 place-items-center rounded-sm border border-line bg-surface/95 text-lg text-ink shadow-lg backdrop-blur transition hover:border-iris hover:text-iris sm:right-6 dark:border-night-line dark:bg-night-surface/95 dark:text-slate-200"
	>
		<span aria-hidden="true" class="-translate-y-px">↑</span>
	</button>
{/if}
