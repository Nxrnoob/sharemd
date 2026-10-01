<script lang="ts">
	import { untrack } from 'svelte';

	// Stable element-or-null: the reader passes `articleEl` directly, never a
	// per-render closure, so the effect below re-runs only when the target
	// element itself swaps (unlock, navigate).
	let { target }: { target: HTMLElement | null } = $props();

	let pct = $state(0);

	$effect(() => {
		// The ONLY tracked read: element identity. `pct` is never read here
		// except through `untrack`, so writing it cannot retrigger this effect.
		const el = target;
		let raf = 0;
		let dead = false;

		const commit = (next: number) => {
			if (untrack(() => pct) === next) return;
			pct = next;
		};

		// Reads raw DOM + window only. No $state in, guarded write out.
		const measure = () => {
			raf = 0;
			if (dead) return;
			if (!el) {
				commit(0);
				return;
			}
			const top = el.getBoundingClientRect().top + window.scrollY;
			const total = el.offsetHeight - window.innerHeight + 160;
			if (total <= 0) {
				commit(window.scrollY + 160 >= top ? 100 : 0);
				return;
			}
			commit(Math.min(100, Math.max(0, ((window.scrollY + 160 - top) / total) * 100)));
		};

		// Handlers only schedule a frame; they never write state.
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(measure);
		};

		measure();
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		return () => {
			dead = true;
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			if (raf) cancelAnimationFrame(raf);
		};
	});
</script>

<div class="fixed inset-x-0 top-0 z-50 h-[3px]" aria-hidden="true">
	<div class="h-full w-full origin-left bg-iris" style="transform: scaleX({pct / 100})"></div>
</div>
