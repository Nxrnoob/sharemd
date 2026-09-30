<script lang="ts">
	import { tick, onDestroy } from 'svelte';
	import type { TocItem } from './TocRail.svelte';

	let { items = [], activeId = null }: { items: TocItem[]; activeId: string | null } = $props();

	let pastHero = $state(false);
	let open = $state(false);
	let root: HTMLElement | null = $state(null);
	let panel: HTMLElement | null = $state(null);
	let trigger: HTMLButtonElement | null = $state(null);

	const enabled = $derived(items.length >= 3);
	const current = $derived(items.find((i) => i.id === activeId) ?? items[0] ?? null);

	function onScroll() {
		pastHero = window.scrollY > 400;
		if (!pastHero && open) {
			open = false;
			delete document.documentElement.dataset.tocOpen;
		}
	}

	async function setOpen(v: boolean) {
		open = v;
		// Keep the site header visible while the panel is open.
		if (v) document.documentElement.dataset.tocOpen = 'true';
		else delete document.documentElement.dataset.tocOpen;
		if (!v) {
			trigger?.focus();
			return;
		}
		await tick();
		const active = panel?.querySelector<HTMLElement>('a[aria-current="true"]');
		if (active) active.focus();
		else panel?.querySelector<HTMLElement>('a')?.focus();
	}

	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) setOpen(false);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			setOpen(false);
		}
	}

	onDestroy(() => {
		if (typeof document !== 'undefined') delete document.documentElement.dataset.tocOpen;
	});
</script>

<svelte:window onscroll={onScroll} onclick={onWindowClick} onkeydown={onKey} />

{#if enabled && pastHero}
	<div bind:this={root} class="fixed bottom-5 left-4 z-40 sm:left-6">
		{#if open && current}
			<div
				bind:this={panel}
				role="dialog"
				aria-label="Table of contents"
				class="toast-in mb-3 max-h-[50vh] w-[calc(100vw-2rem)] max-w-xs overflow-auto rounded-2xl border border-line bg-surface p-3 shadow-xl dark:border-night-line dark:bg-night-surface"
			>
				<p class="px-1 font-mono text-[11px] tracking-wide text-ink-soft uppercase dark:text-slate-500">
					On this page
				</p>
				<ul class="mt-1.5 space-y-0.5">
					{#each items as item (item.id)}
						<li class={item.level === 3 ? 'pl-4' : item.level === 2 ? 'pl-2' : ''}>
							<a
								href={`#${item.id}`}
								onclick={() => setOpen(false)}
								aria-current={activeId === item.id ? 'true' : undefined}
								class="block truncate border-l-2 py-1 pl-3 text-[13px] transition {activeId === item.id
									? 'border-iris font-medium text-iris'
									: 'border-line text-ink-soft hover:border-iris/60 hover:text-ink dark:border-night-line dark:text-slate-400 dark:hover:text-slate-100'}"
								>{item.text}</a
							>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<button
			bind:this={trigger}
			type="button"
			onclick={() => setOpen(!open)}
			aria-haspopup="dialog"
			aria-expanded={open}
			aria-label={current ? `Table of contents, current section: ${current.text}` : 'Table of contents'}
			class="flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-line bg-surface/95 py-2 pr-4 pl-3 shadow-lg backdrop-blur transition hover:border-iris sm:max-w-xs dark:border-night-line dark:bg-night-surface/95"
		>
			<span aria-hidden="true" class="shrink-0 font-mono text-[13px] text-iris">≡</span>
			<span class="truncate text-[13px] font-medium">{current?.text ?? 'Contents'}</span>
		</button>
	</div>
{/if}
