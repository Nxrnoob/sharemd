<script lang="ts">
	/**
	 * A quiet "back" affordance for pages that sit off the main flow. Deep
	 * pages (a reader, a bundle index) otherwise dead-end: the only way out is
	 * the header, which is easy to miss and easy to lose track of.
	 *
	 * `href` is always caller-validated — never pass raw user input here. See
	 * `bundleBackHref` in the reader for how a `?from=` param is constrained
	 * before it reaches this component.
	 */
	let { href, label }: { href: string; label: string } = $props();
</script>

<a
	{href}
	class="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft transition hover:text-iris dark:text-slate-400"
>
	<svg
		class="size-4 shrink-0"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.75"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M10 3.5 5.5 8l4.5 4.5" />
	</svg>
	{label}
</a>