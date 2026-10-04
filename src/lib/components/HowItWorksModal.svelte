<script lang="ts">
	import { onMount } from 'svelte';

	let { open = $bindable(false) } = $props();

	function close() {
		open = false;
	}

	function onWindowKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			close();
		}
	}

	onMount(() => {
		const onOpen = () => (open = true);
		window.addEventListener('open-sharemd-guide', onOpen);
		return () => window.removeEventListener('open-sharemd-guide', onOpen);
	});
</script>

<svelte:window onkeydown={onWindowKey} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
		role="dialog"
		aria-modal="true"
		aria-labelledby="guide-title"
	>
		<!-- backdrop -->
		<div
			class="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
			onclick={close}
			aria-hidden="true"
		></div>

		<!-- modal pane -->
		<div
			class="rise relative z-10 flex max-h-[88dvh] w-full max-w-xl flex-col border border-line bg-surface shadow-2xl dark:border-night-line dark:bg-night-surface"
		>
			<!-- header -->
			<div class="flex items-center justify-between border-b border-line px-5 py-3.5 dark:border-night-line">
				<h2 id="guide-title" class="font-display text-[17px] font-bold tracking-tight text-ink">
					How ShareMD works
				</h2>
				<button
					type="button"
					onclick={close}
					aria-label="Close guide"
					class="border border-line px-2 py-0.5 font-mono text-xs font-medium text-ink-soft transition hover:border-iris hover:text-iris dark:border-night-line"
				>
					Esc
				</button>
			</div>

			<!-- body -->
			<div class="space-y-5 overflow-y-auto px-5 py-5 text-sm leading-relaxed text-ink-soft sm:px-6">
				<p class="text-[14.5px] text-ink">
					Got a markdown file or raw notes you need to send to a friend or coworker, but do not want it looking like an unformatted text dump? That is what this site is for.
				</p>

				<div class="space-y-4">
					<div class="border-l-2 border-line pl-3.5 dark:border-night-line">
						<h3 class="font-medium text-ink">1. Drop or paste your markdown</h3>
						<p class="mt-0.5">
							Paste your markdown or drag and drop a .md file directly into the editor. It renders code blocks with syntax highlighting, LaTeX math formulas, GitHub alerts, tables, and task lists.
						</p>
					</div>

					<div class="border-l-2 border-line pl-3.5 dark:border-night-line">
						<h3 class="font-medium text-ink">2. Share with one link</h3>
						<p class="mt-0.5">
							Hit Start sharing. You get an unlisted link right away. No signups, no emails, no ads, and no tracking. Whoever opens the link gets a clean reading page with your chosen theme and table of contents.
						</p>
					</div>

					<div class="border-l-2 border-line pl-3.5 dark:border-night-line">
						<h3 class="font-medium text-ink">3. Control your link</h3>
						<p class="mt-0.5">
							Click Link options before sharing if you want to set a password, pick a custom URL slug, set an expiry time, or limit the doc to a specific view count.
						</p>
					</div>

					<div class="border-l-2 border-line pl-3.5 dark:border-night-line">
						<h3 class="font-medium text-ink">4. Edit or delete anytime</h3>
						<p class="mt-0.5">
							Since there are no logins, docs you share from this browser are saved to your Library up in the top bar. You can edit your docs in place or delete them whenever you need to.
						</p>
					</div>
				</div>

				<div class="border border-line bg-paper/60 p-3.5 dark:border-night-line dark:bg-night/60">
					<h4 class="text-xs font-semibold tracking-wider text-ink uppercase">Keyboard shortcuts</h4>
					<ul class="mt-2 space-y-1 font-mono text-xs">
						<li><span class="text-ink">Tab / Shift+Tab</span>: indent or outdent two spaces</li>
						<li><span class="text-ink">Cmd+Enter / Ctrl+Enter</span>: share document</li>
						<li><span class="text-ink">Esc</span>: close popups and dialogs</li>
					</ul>
				</div>
			</div>

			<!-- footer -->
			<div class="flex items-center justify-between border-t border-line px-5 py-3 dark:border-night-line">
				<span class="font-mono text-[11px] text-ink-soft">no accounts · unlisted links</span>
				<button
					type="button"
					onclick={close}
					class="btn-accent px-4 py-1.5 text-xs font-semibold transition"
				>
					Got it
				</button>
			</div>
		</div>
	</div>
{/if}
