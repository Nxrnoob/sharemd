<script lang="ts">
	// Metadata block rendered beneath "On this page" in both TOC surfaces
	// (desktop rail + mobile panel): the folder this doc is filed under and the
	// other docs it links to. Both are optional and the whole block disappears
	// when neither applies, so an unlinked, unfiled doc gains zero chrome.
	//
	// The folder is LOCAL metadata (the owner's shelf — see src/lib/shelf.ts),
	// so it is only ever meaningful to the browser that holds the delete token;
	// the reader passes null for everyone else. Linked pages come from the
	// server load (doc-to-doc references resolved at read time).

	let {
		folder = null,
		linkedPages = [],
		onNavigate,
		class: cls = ''
	}: {
		folder?: { id: string; name: string } | null;
		linkedPages?: { title: string; href: string }[];
		/** mobile panel closes itself when one of these links is followed */
		onNavigate?: () => void;
		class?: string;
	} = $props();
</script>

{#if folder || linkedPages.length}
	<div class={cls}>
		{#if folder}
			<div>
				<p class="font-display text-[13px] font-semibold tracking-tight">Filed in</p>
				<a
					href={`/library?folder=${encodeURIComponent(folder.id)}`}
					onclick={onNavigate}
					class="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line px-2 py-0.5 text-[12px] font-medium text-ink-soft transition hover:border-iris hover:text-iris dark:border-night-line dark:text-slate-400"
				>
					<span aria-hidden="true" class="text-[11px] opacity-70">▸</span>
					<span class="truncate">{folder.name}</span>
				</a>
			</div>
		{/if}

		{#if linkedPages.length}
			<div class={folder ? 'mt-4' : ''}>
				<p class="font-display text-[13px] font-semibold tracking-tight">Linked pages</p>
				<ul class="mt-1 space-y-0.5">
					{#each linkedPages as p (p.href)}
						<li>
							<a
								href={p.href}
								onclick={onNavigate}
								class="block truncate py-0.5 text-[13px] text-ink-soft transition hover:text-iris dark:text-slate-400 dark:hover:text-slate-100"
								>{p.title}</a
							>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}