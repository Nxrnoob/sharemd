<script lang="ts">
	import { goto } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import { copyText } from '$lib/clipboard';
	import { buildThemedUrl, isThemeId, DEFAULT_THEME_ID } from '$lib/themes';
	import type { ThemeId } from '$lib/themes';

	let { data } = $props();

	const MAX_BYTES = 512 * 1024;

	let tab = $state<'upload' | 'paste'>('upload');
	let title = $state('');
	let markdown = $state('');
	let titleTouched = $state(false);
	let dragging = $state(false);
	let busy = $state(false);
	let fileName = $state<string | null>(null);
	let toast = $state<{ message: string; kind: 'ok' | 'error'; link?: string | null } | null>(null);
	let fileInput: HTMLInputElement | null = $state(null);
	let textareaEl: HTMLTextAreaElement | null = $state(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	// Link options (sent only when set; backend ignores unknowns until its lane lands).
	let optionsOpen = $state(false);
	let slug = $state('');
	let optPassword = $state('');
	let expiry = $state('0');
	// NOTE: type="number" binds null when the field is empty, so every use
	// below goes through str() first. Never call .trim() on raw state.
	let maxViews: string | number | null = $state('');
	/** Normalize bound input values: number inputs bind null when empty. */
	function str(v: unknown): string {
		return typeof v === 'string' ? v : v == null ? '' : String(v);
	}
	const slugClean = $derived(str(slug).trim().toLowerCase());
	const slugOk = $derived(/^[a-z0-9-]{3,32}$/.test(slugClean));

	const bytes = $derived(new TextEncoder().encode(markdown).length);
	const overLimit = $derived(bytes > MAX_BYTES);
	const kb = $derived((bytes / 1024).toFixed(bytes < 10240 ? 1 : 0));
	const charCount = $derived(markdown.length);
	const pct = $derived(Math.min(100, (bytes / MAX_BYTES) * 100));
	const canShare = $derived(markdown.trim().length > 0 && !overLimit && !busy);
	const recentTop = $derived(data.recent.slice(0, 3));

	function showToast(message: string, kind: 'ok' | 'error' = 'ok', link: string | null = null) {
		if (toastTimer) clearTimeout(toastTimer);
		toast = { message, kind, link };
		toastTimer = setTimeout(() => (toast = null), 4500);
	}

	function autoTitle(src: string) {
		if (titleTouched) return;
		const m = src.match(/^#{1,3}\s+(.+?)\s*$/m);
		if (m) title = m[1].replace(/[*_`~\[\]()!#]/g, '').trim().slice(0, 200);
	}

	function onMarkdownInput(v: string) {
		markdown = v;
		autoTitle(v);
	}

	function focusEditor() {
		textareaEl?.focus({ preventScroll: true });
	}

	async function readFile(file: File | undefined | null) {
		if (!file) return;
		const looksMd = /\.md(?:own|x)?$/i.test(file.name) || file.type === 'text/markdown';
		if (!looksMd && file.type !== '' && file.type !== 'text/plain') {
			showToast(`That file is ${file.type || 'not markdown'}. Drop a .md file instead.`, 'error');
			return;
		}
		if (!/\.md(?:own|x)?$/i.test(file.name)) {
			showToast('Please choose a file ending in .md.', 'error');
			return;
		}
		try {
			const text = await file.text();
			fileName = file.name;
			onMarkdownInput(text);
			showToast(`Loaded ${file.name}. Edit below, then share.`);
		} catch {
			showToast('Could not read that file. Try again or paste the text.', 'error');
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		readFile(e.dataTransfer?.files?.[0]);
	}

	async function share() {
		const titleStr = str(title);
		const mdStr = str(markdown);
		const finalTitle = titleStr.trim() || autoTitleFromMarkdown() || 'Untitled';
		if (!mdStr.trim()) {
			showToast('Add some markdown first. Paste text or drop a .md file.', 'error');
			return;
		}
		if (overLimit) {
			showToast('That doc is over 512KB. Trim it down, then share again.', 'error');
			return;
		}
		const cleanSlug = str(slug).trim().toLowerCase();
		if (cleanSlug && !/^[a-z0-9-]{3,32}$/.test(cleanSlug)) {
			showToast('Slugs use a-z, 0-9 and dashes, 3 to 32 long. Fix it and try again.', 'error');
			return;
		}
		const pwStr = str(optPassword);
		if (pwStr && pwStr.length < 4) {
			showToast('Passwords need at least 4 characters. Fix it and try again.', 'error');
			return;
		}
		const expirySecs = expiry === '0' ? 0 : parseInt(expiry, 10);
		const maxViewsStr = str(maxViews);
		const maxV = maxViewsStr === '' ? 0 : Number(maxViewsStr);
		if (maxViewsStr !== '' && (!Number.isInteger(maxV) || maxV < 1)) {
			showToast('Max views must be 1 or more, or leave it empty.', 'error');
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/docs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title: finalTitle.slice(0, 200),
					markdown: mdStr,
					...(cleanSlug ? { slug: cleanSlug } : {}),
					...(pwStr ? { password: pwStr } : {}),
					...(expirySecs ? { expiresInSec: expirySecs } : {}),
					...(maxV ? { maxViews: maxV } : {})
				})
			});
			const raw = (await res.json().catch(() => ({}))) as unknown;
			const out = raw && typeof raw === 'object' ? (raw as { id?: string; url?: string; error?: string }) : {};
			if (!res.ok || typeof out.id !== 'string' || !out.id) {
				showToast(friendlyError(res.status, typeof out.error === 'string' ? out.error : undefined), 'error');
				return;
			}
			const saved = typeof document !== 'undefined' ? document.documentElement.dataset.theme : null;
			const themeId: ThemeId = isThemeId(saved) ? saved : DEFAULT_THEME_ID;
			const url = buildThemedUrl(typeof out.url === 'string' && out.url ? out.url : `/s/${out.id}`, themeId);
			if (await copyText(new URL(url, location.origin).href)) {
				showToast('Shared. Link copied. Paste it anywhere.', 'ok', url);
			} else {
				showToast('Shared. Copy the link from the address bar.', 'ok', url);
			}
			setTimeout(() => goto(url), 650);
		} catch {
			showToast('Could not reach the server. Check your connection and retry.', 'error');
		} finally {
			busy = false;
		}
	}

	function autoTitleFromMarkdown(): string | null {
		const m = markdown.match(/^#{1,3}\s+(.+?)\s*$/m);
		return m ? m[1].replace(/[*_`~\[\]()!#]/g, '').trim().slice(0, 200) : null;
	}

	function friendlyError(status: number, serverMsg?: string): string {
		if (status === 413) return 'That doc is over 512KB. Trim it down, then share again.';
		if (status === 429) return 'Too many shares from this address. Wait a bit, then retry.';
		if (status === 409 || /taken|already exists|in use|conflict/i.test(serverMsg ?? '')) {
			return 'That slug is taken, try another.';
		}
		if (/slug/i.test(serverMsg ?? '')) {
			return 'That slug will not work. Use a-z, 0-9 and dashes, 3 to 32 long.';
		}
		if (serverMsg?.includes('non-empty')) return 'Add a title and some markdown, then share.';
		return serverMsg ? `Share failed: ${serverMsg}. Fix that and retry.` : 'Share failed. Try again.';
	}

	async function copySlugPreview() {
		if (!slugOk) return;
		const saved = typeof document !== 'undefined' ? document.documentElement.dataset.theme : null;
		const themeId: ThemeId = isThemeId(saved) ? saved : DEFAULT_THEME_ID;
		const preview = buildThemedUrl(`/s/${slugClean}`, themeId);
		if (await copyText(new URL(preview, location.origin).href)) {
			showToast('Slug link copied.', 'ok', preview);
		} else {
			showToast('Copy failed. Select the slug text and copy it by hand.', 'error');
		}
	}

	function closeOptions() {
		optionsOpen = false;
	}

	function timeAgo(ts: number): string {
		const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
		if (s < 60) return `${s}s ago`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		return d === 1 ? 'yesterday' : `${d}d ago`;
	}
</script>

<svelte:head>
	<title>ShareMD: paste markdown, share a clean page</title>
	<meta name="description" content="Paste markdown or drop a .md file. Get an unlisted link that reads beautifully." />
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && optionsOpen) closeOptions();
	}}
/>

<main class="landing-lock mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-0">
	<div class="grid gap-8 lg:h-full lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch lg:gap-12">
		<!-- left: brand + headline + cta + recent -->
		<section class="flex min-w-0 flex-col justify-center gap-5 lg:h-full lg:overflow-hidden">
			<div class="rise flex items-center gap-2" aria-hidden="true">
				<span class="grid size-7 place-items-center rounded-lg bg-ink font-mono text-xs font-medium text-white dark:bg-surface dark:text-ink">M</span>
				<span class="font-display text-[15px] font-bold tracking-tight">ShareMD</span>
			</div>
			<div class="rise rise-1">
				<p class="font-mono text-xs tracking-widest text-ink-soft uppercase dark:text-slate-400">
					Markdown sharing for developers
				</p>
				<h1 class="font-display mt-3 text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-5xl lg:text-[2.75rem]">
					Paste markdown.<br />Share a clean link.
				</h1>
				<p class="mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft dark:text-slate-400">
					Drop a .md file or paste text. Get an unlisted page with clean code highlighting.
				</p>
			</div>
			<div class="rise rise-2">
				<button
					type="button"
					onclick={focusEditor}
					class="btn-accent inline-flex items-center justify-center rounded-xl px-6 py-2.5 text-[15px] font-semibold transition"
				>
					Start writing
				</button>
			</div>
			<div class="rise rise-2 min-w-0">
				<h2 class="font-mono text-[11px] tracking-wide text-ink-soft uppercase dark:text-slate-500">Recent</h2>
				{#if recentTop.length}
					<ul class="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface dark:divide-night-line dark:border-night-line dark:bg-night-surface">
						{#each recentTop as doc (doc.id)}
							<li>
								<a href={`/s/${doc.id}`} class="group flex items-center gap-3 px-3.5 py-2 transition hover:bg-iris/[0.04] dark:hover:bg-white/5">
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-medium group-hover:text-iris dark:group-hover:text-indigo-300">{doc.title}</span>
										<span class="mt-0.5 block font-mono text-[11px] text-ink-soft dark:text-slate-500">{timeAgo(doc.createdAt)} · {doc.views} {doc.views === 1 ? 'view' : 'views'}</span>
									</span>
									<span class="shrink-0 text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-iris dark:text-slate-500" aria-hidden="true">→</span>
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm text-ink-soft dark:text-slate-400">No docs yet. Share your first.</p>
				{/if}
			</div>
		</section>

		<!-- right: live editor pane -->
		<section class="min-w-0 lg:h-full lg:min-h-0 lg:py-6">
			<div class="paper-stack h-full" data-dragging={dragging}>
				<div class="flex h-full min-h-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5 dark:border-night-line dark:bg-night-surface">
					<div class="flex shrink-0 flex-wrap items-center justify-between gap-3">
						<div role="tablist" aria-label="Input method" class="inline-flex rounded-xl bg-paper p-1 dark:bg-night">
							<button
								role="tab"
								aria-selected={tab === 'upload'}
								onclick={() => (tab = 'upload')}
								class="rounded-lg px-4 py-1.5 text-sm font-medium transition {tab === 'upload'
									? 'bg-surface text-ink shadow-sm dark:bg-night-surface dark:text-white'
									: 'text-ink-soft hover:text-ink dark:text-slate-400 dark:hover:text-white'}"
							>
								Upload
							</button>
							<button
								role="tab"
								aria-selected={tab === 'paste'}
								onclick={() => (tab = 'paste')}
								class="rounded-lg px-4 py-1.5 text-sm font-medium transition {tab === 'paste'
									? 'bg-surface text-ink shadow-sm dark:bg-night-surface dark:text-white'
									: 'text-ink-soft hover:text-ink dark:text-slate-400 dark:hover:text-white'}"
							>
								Paste
							</button>
						</div>
						<p class="font-mono text-xs text-ink-soft tabular-nums dark:text-slate-500">
							{charCount.toLocaleString()} chars · {kb} KB / 512 KB
						</p>
					</div>

					{#if tab === 'upload'}
						<div
							role="button"
							tabindex="0"
							aria-label="Drop a markdown file here, or press Enter to browse"
							onclick={() => fileInput?.click()}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									fileInput?.click();
								}
							}}
							ondragover={(e) => {
								e.preventDefault();
								dragging = true;
							}}
							ondragleave={() => (dragging = false)}
							ondrop={onDrop}
							class="shrink-0 cursor-pointer rounded-xl border border-dashed px-4 py-4 text-center transition {dragging
								? 'border-iris bg-iris/[0.04]'
								: 'border-line hover:border-iris dark:border-night-line dark:hover:border-indigo-300'}"
						>
							<p class="text-sm font-medium">
								{dragging ? 'Drop it here' : 'Drop your .md file here'}
								<span class="font-normal text-ink-soft dark:text-slate-400">
									or <span class="font-medium text-iris underline underline-offset-2 dark:text-indigo-300">browse files</span>
									{#if fileName}
										· <span class="font-mono text-xs">{fileName}</span>
									{/if}
								</span>
							</p>
							<input
								bind:this={fileInput}
								type="file"
								accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
								class="sr-only"
								aria-label="Choose a markdown file"
								onchange={(e) => readFile(e.currentTarget.files?.[0])}
							/>
						</div>
					{/if}

					<label class="block shrink-0">
						<span class="mb-1.5 flex items-baseline justify-between text-sm font-medium">
							Title
							{#if !titleTouched && title}
								<span class="font-mono text-[11px] font-normal text-ink-soft dark:text-slate-500">taken from your first heading</span>
							{/if}
						</span>
						<input
							bind:value={title}
							oninput={() => (titleTouched = true)}
							maxlength="200"
							placeholder="e.g. Deploy notes for Friday"
							autocomplete="off"
							class="w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
						/>
					</label>

					<label class="flex min-h-0 flex-1 flex-col">
						<span class="mb-1.5 block shrink-0 text-sm font-medium">Markdown</span>
						<textarea
							bind:this={textareaEl}
							value={markdown}
							oninput={(e) => onMarkdownInput(e.currentTarget.value)}
							rows="6"
							placeholder={tab === 'paste' ? '# Paste it here. Headings, tables, tasks, code.' : '# Type here. Dropping a file fills this in.'}
							spellcheck="false"
							class="min-h-0 w-full flex-1 resize-y rounded-xl border border-line bg-paper px-3.5 py-3 font-mono text-[13.5px] leading-relaxed placeholder:text-ink-soft/50 focus:border-iris lg:resize-none dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
						></textarea>
					</label>

					<div class="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
						<div class="min-w-0 flex-1">
							<div class="h-1.5 overflow-hidden rounded-full bg-black/8 dark:bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Size versus 512KB limit">
								<div class="h-full rounded-full transition-all {overLimit ? 'bg-red-500' : 'bg-iris'}" style="width: {pct}%"></div>
							</div>
							<p class="mt-1.5 text-xs {overLimit ? 'font-medium text-red-600 dark:text-red-300' : 'text-ink-soft dark:text-slate-500'}">
								{#if overLimit}
									Over the 512 KB limit. Trim {((bytes - MAX_BYTES) / 1024).toFixed(0)} KB to share.
								{:else if !markdown.trim()}
									Nothing to share yet.
								{:else}
									Fits the limit. Good to share.
								{/if}
							</p>
						</div>
					<div class="relative flex shrink-0 items-center gap-2">
						<button
							type="button"
							onclick={() => (optionsOpen = !optionsOpen)}
							aria-expanded={optionsOpen}
							aria-haspopup="dialog"
							class="inline-flex items-center justify-center rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-iris hover:text-ink dark:border-night-line dark:text-slate-400 dark:hover:text-white"
						>
							Link options
						</button>
						{#if optionsOpen}
							<div
								class="fixed inset-0 z-40 cursor-default"
								onclick={closeOptions}
								aria-hidden="true"
							></div>
							<div
								role="dialog"
								aria-label="Link options"
								class="absolute right-0 bottom-full z-50 mb-2 max-h-[60dvh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-xl dark:border-night-line dark:bg-night-surface"
							>
								<label class="block">
									<span class="mb-1.5 block text-sm font-medium">Custom slug</span>
									<input
										bind:value={slug}
										maxlength="32"
										placeholder="my-doc-name"
										autocomplete="off"
										spellcheck="false"
										class="w-full rounded-xl border border-line bg-paper px-3 py-2 font-mono text-[13px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
									/>
									<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">a-z, 0-9 and dashes, 3 to 32 long.</span>
								</label>
								{#if slugOk}
									<button
										type="button"
										onclick={copySlugPreview}
										title="Copy slug link"
										class="mt-2 block w-full truncate rounded-lg bg-paper px-2.5 py-1.5 text-left font-mono text-xs text-iris hover:underline dark:bg-night dark:text-indigo-300"
									>
										/s/{slugClean} ⧉
									</button>
								{/if}
								<label class="mt-3 block">
									<span class="mb-1.5 block text-sm font-medium">Password</span>
									<input
										type="password"
										bind:value={optPassword}
										placeholder="Optional"
										autocomplete="new-password"
										class="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
									/>
									<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">Min 4 characters. Readers type this to open the link.</span>
								</label>
								<div class="mt-3 grid grid-cols-2 gap-3">
									<label class="block">
										<span class="mb-1.5 block text-sm font-medium">Expires</span>
										<select
											bind:value={expiry}
											class="w-full rounded-xl border border-line bg-paper px-2.5 py-2 text-sm focus:border-iris dark:border-night-line dark:bg-night"
										>
											<option value="0">Never</option>
											<option value="3600">1 hour</option>
											<option value="86400">1 day</option>
											<option value="604800">7 days</option>
											<option value="2592000">30 days</option>
										</select>
									</label>
									<label class="block">
										<span class="mb-1.5 block text-sm font-medium">Max views</span>
										<input
											type="number"
											inputmode="numeric"
											min="1"
											step="1"
											bind:value={maxViews}
											placeholder="Unlimited"
											class="w-full rounded-xl border border-line bg-paper px-2.5 py-2 text-sm placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
										/>
									</label>
								</div>
								<button
									type="button"
									onclick={closeOptions}
									class="btn-accent mt-4 w-full rounded-xl px-4 py-2 text-sm font-semibold transition"
								>
									Done
								</button>
							</div>
						{/if}
						<button
							onclick={share}
							disabled={!canShare}
							class="btn-accent inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-[15px] font-semibold transition"
						>
							{#if busy}
								<span class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60" aria-hidden="true"></span>
								Sharing…
							{:else}
								Share
							{/if}
						</button>
					</div>
					</div>
					<p class="mt-2 shrink-0 text-center font-mono text-[11px] text-ink-soft sm:text-left dark:text-slate-500">
						Link carries your current theme.
					</p>
				</div>
			</div>
		</section>
	</div>
</main>

<Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} link={toast?.link ?? null} />
