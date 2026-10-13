<script lang="ts">
	// Fixed section indicator for the reader: while you scroll a long doc, the
	// section you're currently in stays pinned at the very top of the viewport.
	//
	// Layering contract: the reading-progress line is `fixed top-0 z-50 h-[3px]`,
	// so this bar renders at top-0 with 3px of top padding — the progress line
	// paints over that padding and the heading text sits directly below it.
	// z-40 keeps it under the progress line but above page content.
	//
	// It yields to the site header: the header slides away on scroll-down and
	// slides back on any scroll-up, and a fixed bar would paint over it (z-30).
	// The layout publishes its state on <html data-header-hidden> — the same
	// channel as data-toc-open — and this component reads it imperatively in its
	// own scroll handler, so no reactive plumbing crosses the layout boundary.
	// The one-event lag is ~16ms against a 300ms header transition: invisible.

	let { text }: { text: string | null } = $props();

	let shown = $state(false);

	$effect(() => {
		const t = text; // tracked: re-evaluate when the active section changes
		const evaluate = () => {
			const root = document.documentElement;
			const headerHidden = root.dataset.headerHidden === 'true';
			const tocOpen = root.dataset.tocOpen === 'true';
			shown = headerHidden && !tocOpen && !!t;
		};
		evaluate();
		window.addEventListener('scroll', evaluate, { passive: true });
		return () => window.removeEventListener('scroll', evaluate);
	});
</script>

<div
	class="fixed inset-x-0 top-0 z-40 pt-[3px] transition-transform duration-200 print:hidden {shown
		? 'translate-y-0'
		: '-translate-y-full'}"
	aria-hidden={!shown}
>
	<div class="border-b border-line bg-surface/90 backdrop-blur dark:border-night-line dark:bg-night-surface/90">
		<div class="mx-auto flex h-9 w-full max-w-3xl items-center gap-2 px-4 sm:px-6 lg:max-w-7xl">
			<span class="h-3.5 w-0.5 shrink-0 bg-iris" aria-hidden="true"></span>
			<span class="min-w-0 truncate font-display text-[13px] font-semibold tracking-tight text-ink dark:text-slate-100">
				{text ?? ''}
			</span>
		</div>
	</div>
</div>