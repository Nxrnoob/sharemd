<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import ThemePicker from '$lib/components/ThemePicker.svelte';

	let { children } = $props();

	let headerHidden = $state(false);
	const isReader = $derived(page.url.pathname.startsWith('/s/'));

	// Hide-on-scroll, reader only: slide away past ~120px scrolling down,
	// back on any scroll up. Landing header never hides.
	onMount(() => {
		let lastY = window.scrollY;
		const onScroll = () => {
			const y = window.scrollY;
			const onReaderRoute = page.url.pathname.startsWith('/s/');
			const tocOpen = document.documentElement.dataset.tocOpen === 'true';
			if (!onReaderRoute || y <= 120 || tocOpen) headerHidden = false;
			else if (y > lastY + 4) headerHidden = true;
			else if (y < lastY - 4) headerHidden = false;
			lastY = y;
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// Reset on navigation so a hidden header never leaks onto another route.
	$effect(() => {
		void page.url.pathname;
		headerHidden = false;
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-dvh flex-col">
	<header
		class="site-header z-30 border-b border-line bg-paper/85 backdrop-blur transition-transform duration-300 dark:border-night-line dark:bg-night/85 {isReader
			? 'sticky top-0'
			: 'lg:sticky lg:top-0'} {headerHidden && isReader ? '-translate-y-full' : ''}"
	>
		<div class="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
			<a href="/" class="flex items-center gap-2" aria-label="ShareMD home">
				<span
					class="grid size-7 place-items-center bg-ink font-mono text-xs font-medium text-white dark:bg-surface dark:text-ink"
					aria-hidden="true">M</span
				>
				<span class="font-display text-[16px] font-bold tracking-tight">ShareMD</span>
			</a>
			<div class="flex items-center gap-2">
				<a
					href="/"
					class=" px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-black/5 hover:text-ink dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
					>New doc</a
				>
				<ThemePicker />
			</div>
		</div>
	</header>
	<div class="flex-1">
		{@render children()}
	</div>
	<footer class="border-t border-line py-5 dark:border-night-line">
		<p class="mx-auto w-full max-w-5xl px-4 text-[13px] text-ink-soft sm:px-6 dark:text-slate-500">
			ShareMD — markdown in, clean page out.
		</p>
	</footer>
</div>

