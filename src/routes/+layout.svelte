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

<!-- Letter Field layering: this stacking context paints above the fixed
     body-level ghost-letter canvas (z-0), which itself composites above the
     opaque body background. See art/letter-field.js. -->
<div class="relative z-10 flex min-h-dvh flex-col">
	<header
		class="site-header z-30 border-b border-line transition-transform duration-300 dark:border-night-line {isReader
			? 'sticky top-0'
			: 'lg:sticky lg:top-0'} {headerHidden && isReader ? '-translate-y-full' : ''}"
	>
		<div class="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
			<a href="/" class="flex items-center" aria-label="ShareMD home">
				<span class="font-display text-[17px] font-semibold"><span class="font-medium">share</span><span
						class="font-bold">MD</span></span
				>
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
		<div class="mx-auto flex w-full max-w-5xl items-center justify-center px-4 sm:px-6">
			<a
				href="https://github.com/Nxrnoob/sharemd"
				target="_blank"
				rel="noopener"
				aria-label="ShareMD on GitHub"
				class="inline-flex items-center gap-2 text-[13px] font-medium text-ink-soft transition hover:text-ink dark:text-slate-500 dark:hover:text-white"
			>
				<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="size-4"><path
						d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
					/></svg>
				<span>GitHub</span>
			</a>
		</div>
	</footer>
</div>

