<script lang="ts">
	export interface TocItem {
		id: string;
		text: string;
		level: number;
	}

	let { items = [], activeId = null }: { items: TocItem[]; activeId: string | null } = $props();
</script>

{#if items.length}
	<aside class="hidden self-start lg:block" aria-label="Table of contents sidebar">
		<nav
			aria-label="Table of contents"
			class="sticky top-24 max-h-[calc(100vh-7rem)] overflow-auto rounded-2xl border border-line bg-surface p-4 dark:border-night-line dark:bg-night-surface"
		>
			<p class="font-mono text-[11px] tracking-wide text-ink-soft uppercase dark:text-slate-500">
				On this page
			</p>
			<ul class="mt-2 space-y-0.5">
				{#each items as item (item.id)}
					<li class={item.level === 3 ? 'pl-4' : item.level === 2 ? 'pl-2' : ''}>
						<a
							href={`#${item.id}`}
							aria-current={activeId === item.id ? 'true' : undefined}
							class="block truncate border-l-2 py-1 pl-3 text-[13px] transition {activeId === item.id
								? 'border-iris font-medium text-iris'
								: 'border-line text-ink-soft hover:border-iris/60 hover:text-ink dark:border-night-line dark:text-slate-400 dark:hover:text-slate-100'}"
							>{item.text}</a
						>
					</li>
				{/each}
			</ul>
		</nav>
	</aside>
{/if}
