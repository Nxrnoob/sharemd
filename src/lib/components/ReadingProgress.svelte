<script lang="ts">
	import { onMount } from 'svelte';

	let { getTarget }: { getTarget: () => HTMLElement | null } = $props();

	let pct = $state(0);

	onMount(() => {
		let raf = 0;
		const measure = () => {
			raf = 0;
			const el = getTarget();
			if (!el) {
				pct = 0;
				return;
			}
			const top = el.getBoundingClientRect().top + window.scrollY;
			const total = el.offsetHeight - window.innerHeight + 160;
			if (total <= 0) {
				pct = window.scrollY + 160 >= top ? 100 : 0;
				return;
			}
			pct = Math.min(100, Math.max(0, ((window.scrollY + 160 - top) / total) * 100));
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

<div class="fixed inset-x-0 top-0 z-50 h-[3px]" aria-hidden="true">
	<div class="h-full w-full origin-left bg-iris" style="transform: scaleX({pct / 100})"></div>
</div>
