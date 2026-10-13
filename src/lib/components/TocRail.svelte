<script lang="ts">
	import TocMeta from './TocMeta.svelte';

	export interface TocItem {
		id: string;
		text: string;
		level: number;
	}

	let {
		items = [],
		activeId = null,
		folder = null,
		linkedPages = []
	}: {
		items: TocItem[];
		activeId: string | null;
		/** owner-only local metadata; null for viewers (see src/lib/shelf.ts) */
		folder: { id: string; name: string } | null;
		linkedPages: { title: string; href: string }[];
	} = $props();
</script>

{#if items.length}
	<!-- No self-start: the aside must stretch to the grid row's full height or
	     the sticky nav inside it has no room to travel and the rail scrolls
	     away with the page (it previously never actually stuck). -->
	<aside class="hidden lg:block" aria-label="Table of contents sidebar">
		<nav
			aria-label="Table of contents"
			class="sticky top-24 max-h-[calc(100vh-7rem)] overflow-auto py-1"
		>
			<p class="font-display text-[13px] font-semibold tracking-tight">
				On this page
			</p>
			<ul class="mt-2 space-y-0.5">
				{#each items as item (item.id)}
					<li class={item.level === 3 ? 'pl-4' : item.level === 2 ? 'pl-2' : ''}>
						<a
							href={`#${item.id}`}
							aria-current={activeId === item.id ? 'true' : undefined}
							class="block truncate border-l-2 py-1 pl-3 text-[13px] transition {activeId === item.id
								? 'font-display border-iris font-semibold text-iris'
								: 'border-transparent text-ink-soft hover:border-iris/60 hover:text-ink dark:text-slate-400 dark:hover:text-slate-100'}"
							>{item.text}</a
						>
					</li>
				{/each}
			</ul>

			<TocMeta {folder} {linkedPages} class="mt-5 border-t border-line pt-4 dark:border-night-line" />
		</nav>
	</aside>
{/if}
