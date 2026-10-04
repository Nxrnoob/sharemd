<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Toast from '$lib/components/Toast.svelte';
	import CoverArt from '$lib/components/CoverArt.svelte';
	import DeleteDocButton from '$lib/components/DeleteDocButton.svelte';
	import LetterField from '$lib/components/LetterField.svelte';
	import { copyText } from '$lib/clipboard';
	import { addToShelf, getShelf, type ShelfEntry } from '$lib/shelf';
	import type { DeleteResult } from '$lib/shelf';
	import { buildThemedUrl, isThemeId, DEFAULT_THEME_ID } from '$lib/themes';
	import type { ThemeId } from '$lib/themes';

	let { data } = $props();

	const MAX_BYTES = 512 * 1024;

	let title = $state('');
	let markdown = $state('');
	let titleTouched = $state(false);
	let dragging = $state(false);
	let busy = $state(false);
	let fileName = $state<string | null>(null);
	let toast = $state<{ message: string; kind: 'ok' | 'error'; link?: string | null } | null>(null);
	let fileInput: HTMLInputElement | null = $state(null);
	let textareaEl: HTMLTextAreaElement | null = $state(null);
	// Letter Field: imperatively-planted ghost glyphs of the user's own
	// input (body-level canvas, decorative only — never blocks input).
	let letterField: { plant: (text: string) => void } | null = $state(null);
	let lastFieldPlant = 0;
	// Silent-token shelf: ids shared from this browser (delete affordance).
	// Hydrated client-side; SSR renders rows without icons.
	let shelfIds = $state<Set<string>>(new Set());
	let hiddenIds = $state<Set<string>>(new Set());
	let shelfDocs = $state<ShelfEntry[]>([]);

	// Whole-panel drop target: files can land anywhere on the machine.
	let panelEl: HTMLElement | null = $state(null);
	const DRAFT_KEY = 'sharemd-draft';
	let draftTimer: ReturnType<typeof setTimeout> | null = null;

	function saveDraft(t: string, md: string) {
		if (typeof localStorage === 'undefined') return;
		if (draftTimer) clearTimeout(draftTimer);
		draftTimer = setTimeout(() => {
			if (!t.trim() && !md.trim()) {
				try {
					localStorage.removeItem(DRAFT_KEY);
				} catch {}
			} else {
				try {
					localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: t, markdown: md }));
				} catch {}
			}
		}, 300);
	}

	function clearDraft() {
		if (draftTimer) clearTimeout(draftTimer);
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.removeItem(DRAFT_KEY);
			} catch {}
		}
	}

	onMount(() => {
		const items = getShelf();
		shelfDocs = items;
		shelfIds = new Set(items.map((e) => e.id));
		try {
			const saved = localStorage.getItem(DRAFT_KEY);
			if (saved) {
				const parsed = JSON.parse(saved) as { title?: unknown; markdown?: unknown };
				if (typeof parsed.markdown === 'string' && parsed.markdown.trim()) {
					markdown = parsed.markdown;
					if (typeof parsed.title === 'string' && parsed.title.trim()) {
						title = parsed.title;
						titleTouched = true;
					}
					showToast('Draft restored from your last visit.');
				}
			}
		} catch {}
	});
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
	const visibleRecent = $derived(shelfDocs.filter((d) => !hiddenIds.has(d.id)).slice(0, 3));

	function onRecentDeleted(id: string) {
		// Reassign (not mutate): $state Set updates only on assignment,
		// so in-place add/delete would leave the row and its icon on screen.
		hiddenIds = new Set(hiddenIds).add(id);
		const next = new Set(shelfIds);
		next.delete(id);
		shelfIds = next;
		shelfDocs = shelfDocs.filter((d) => d.id !== id);
		showToast('Doc deleted.');
	}

	function onDeleteFailed(reason: Exclude<DeleteResult, 'deleted'>) {
		showToast(reason === 'missing' ? 'That doc is already gone.' : 'Delete failed. Try again.', 'error');
	}

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
		saveDraft(title, v);
	}

	// Letter Field wiring: keystrokes pass their ACTUAL character from the
	// input event (printable chars only, burst-capped per event, 40ms gate
	// for single keystrokes); pastes pass up to N chars per event and skip
	// the gate; backspace/delete/cut/undo plant nothing.
	function plantFromEditorInput(e: Event) {
		const input = e as InputEvent;
		const type = typeof input.inputType === 'string' ? input.inputType : '';
		if (type.startsWith('delete') || type === 'historyUndo' || type === 'historyRedo') return;
		const raw = typeof input.data === 'string' ? input.data : null;
		if (!raw) return;
		const coarse =
			typeof window !== 'undefined' &&
			(window.matchMedia('(pointer: coarse)').matches ||
				Math.min(window.innerWidth, window.innerHeight) < 560);
		const chars = [...raw]
			.filter((ch) => {
				if (ch.trim() === '') return false;
				const cp = ch.codePointAt(0);
				return typeof cp === 'number' && cp > 31 && cp !== 127;
			})
			.slice(0, coarse ? 6 : 12)
			.join('');
		if (!chars) return;
		const now = performance.now();
		if (chars.length === 1 && now - lastFieldPlant < 40) return;
		lastFieldPlant = now;
		try {
			letterField?.plant(chars);
		} catch {
			/* decorative only: input must never fail because art did */
		}
	}

	function onEditorInput(e: Event & { currentTarget: HTMLTextAreaElement }) {
		plantFromEditorInput(e);
		onMarkdownInput(e.currentTarget.value);
	}

	function onEditorKeyDown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			if (canShare) share();
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			const ta = e.currentTarget;
			const start = ta.selectionStart;
			const end = ta.selectionEnd;
			const val = ta.value;
			if (e.shiftKey) {
				const lineStart = val.lastIndexOf('\n', start - 1) + 1;
				if (val.slice(lineStart, lineStart + 2) === '  ') {
					ta.value = val.slice(0, lineStart) + val.slice(lineStart + 2);
					ta.selectionStart = Math.max(lineStart, start - 2);
					ta.selectionEnd = Math.max(lineStart, end - 2);
					onMarkdownInput(ta.value);
				} else if (val[lineStart] === ' ') {
					ta.value = val.slice(0, lineStart) + val.slice(lineStart + 1);
					ta.selectionStart = Math.max(lineStart, start - 1);
					ta.selectionEnd = Math.max(lineStart, end - 1);
					onMarkdownInput(ta.value);
				}
			} else {
				ta.value = val.substring(0, start) + '  ' + val.substring(end);
				ta.selectionStart = ta.selectionEnd = start + 2;
				onMarkdownInput(ta.value);
			}
		}
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

	// Panel-wide drag affordance: any hover inside the machine lights the
	// strip; dragleave only clears when the pointer truly left the panel
	// (child-to-child moves bubble dragleave and must not flicker).
	function onPanelDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}
	function onPanelDragLeave(e: DragEvent) {
		if (e.relatedTarget instanceof Node && panelEl?.contains(e.relatedTarget)) return;
		dragging = false;
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
			const out =
				raw && typeof raw === 'object'
					? (raw as { id?: string; url?: string; error?: string; slug?: string; deleteToken?: string })
					: {};
			if (!res.ok || typeof out.id !== 'string' || !out.id) {
				showToast(friendlyError(res.status, typeof out.error === 'string' ? out.error : undefined), 'error');
				return;
			}
			// Silent shelf record: the delete token never appears in UI.
			const deleteToken = typeof out.deleteToken === 'string' && out.deleteToken ? out.deleteToken : null;
			if (deleteToken) {
				try {
					addToShelf({
						id: out.id,
						slug: typeof out.slug === 'string' && out.slug ? out.slug : null,
						title: finalTitle.slice(0, 200),
						token: deleteToken,
						createdAt: Date.now()
					});
					// Reassign (not mutate) so the own-row icon appears reactively.
					shelfDocs = getShelf();
					shelfIds = new Set(shelfDocs.map((e) => e.id));
				} catch {
					/* shelf is best-effort; the share already succeeded */
				}
			}
			clearDraft();
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
	<title>Paste the md your AI gave you and Read it beautifully here · ShareMD</title>
	<meta name="description" content="paste your markdown and get a clean link to share" />
	<meta property="og:site_name" content="ShareMD" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Paste the md your AI gave you and Read it beautifully here" />
	<meta property="og:description" content="paste your markdown and get a clean link to share" />
	<meta property="og:image" content="/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Paste the md your AI gave you and Read it beautifully here" />
	<meta name="twitter:description" content="paste your markdown and get a clean link to share" />
	<meta name="twitter:image" content="/og.png" />
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && optionsOpen) closeOptions();
	}}
/>

<main class="landing-lock mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-0">
	<!-- Letter Field: body-level ghost-letter canvas (imperatively mounted,
	     aria-hidden, pointer-transparent). Landing only — reader untouched. -->
	<LetterField bind:this={letterField} />
	<div class="grid gap-8 lg:h-full lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch lg:gap-12">
		<!-- left: headline + subtext + cta + recent, one flowing centered
		   column (a7f6b35 geometry). On phones the section dissolves via
		   display:contents so its children interleave with the panel:
		   headline, panel, subtext, cta, recent. -->
		<section
			class="flex min-w-0 flex-col gap-6 max-lg:contents lg:h-full lg:justify-center lg:overflow-hidden"
		>
			<div class="rise rise-1 min-w-0 max-lg:order-1">
				<h1
					class="font-display relative text-balance font-bold tracking-tight text-[clamp(1.5rem,2.3vw,1.6875rem)] leading-[1.12]"
				>
					Paste the md your AI gave you and<br class="hidden lg:block" /> Read it beautifully here.
				</h1>
			</div>
			<div class="rise rise-2 max-lg:order-3">
				<button
					type="button"
					onclick={focusEditor}
					class="btn-accent btn-mag group inline-flex items-center justify-center gap-2 px-6 py-2.5 text-[15px] font-semibold active:scale-[0.98]"
				>
					Start pasting
					<span aria-hidden="true" class="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-1">→</span>
				</button>
			</div>
			<div class="rise rise-2 min-w-0 max-lg:order-4">
				<h2 class="text-[11px] tracking-wide text-ink-soft uppercase dark:text-slate-500">Recent</h2>
				{#if visibleRecent.length}
					<ul class="mt-2 divide-y divide-line overflow-hidden border border-line bg-surface dark:divide-night-line dark:border-night-line dark:bg-night-surface">
						{#each visibleRecent as doc (doc.id)}
							<li class="flex items-stretch">
								<a href={`/s/${doc.slug ?? doc.id}`} class="group flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2 transition hover:bg-iris/[0.04] dark:hover:bg-white/5">
									<!-- Same Quiet Signals field as the reader banner, one seed per doc id. -->
									<CoverArt
										seedText={doc.id}
										width={96}
										height={96}
										class="size-10 shrink-0 border border-line dark:border-night-line"
									/>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-medium group-hover:text-iris">{doc.title}</span>
										<span class="mt-0.5 block font-mono text-[11px] text-ink-soft dark:text-slate-500">{timeAgo(doc.createdAt)}</span>
									</span>
									<span class="shrink-0 text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-iris dark:text-slate-500" aria-hidden="true">→</span>
								</a>
								{#if shelfIds.has(doc.id)}
									<span class="flex shrink-0 items-center pr-1">
										<DeleteDocButton id={doc.id} title={doc.title} onDeleted={onRecentDeleted} onDeleteFailed={onDeleteFailed} />
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm text-ink-soft dark:text-slate-400">No docs yet. Share your first.</p>
				{/if}
			</div>
		</section>

		<!-- right: live editor pane -->
		<section class="min-w-0 max-lg:order-2 lg:h-full lg:min-h-0 lg:py-6">
			<div class="paper-stack h-full" data-dragging={dragging}>
				<div
					bind:this={panelEl}
					ondragover={onPanelDragOver}
					ondragleave={onPanelDragLeave}
					ondrop={onDrop}
					role="region"
					aria-label="Markdown editor, drop a file anywhere in this panel"
					class="machine machine-artifact flex h-full min-h-0 flex-col gap-4 border border-line bg-surface p-4 sm:p-5 dark:border-night-line dark:bg-night-surface"
				>
					<!-- drop strip: one affordance, not a mode. Files can land
					   anywhere on the panel; the strip also opens the browser. -->
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
						class="shrink-0 cursor-pointer border border-dashed px-4 py-2.5 text-center transition {dragging
							? 'border-solid border-iris bg-iris/[0.08]'
							: 'border-line hover:border-iris dark:border-night-line'}"
					>
						<p class="text-sm font-medium">
							{dragging ? 'Drop it here' : 'Drop your .md file here'}
							<span class="font-normal text-ink-soft dark:text-slate-400">
								or <span class="font-medium text-iris underline underline-offset-2">browse files</span>
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

					<label class="block shrink-0">
						<span class="mb-1.5 flex items-baseline justify-between text-sm font-medium">
							Title
							{#if !titleTouched && title}
								<span class="text-[11px] font-normal text-ink-soft dark:text-slate-500">taken from your first heading</span>
							{/if}
						</span>
						<input
							bind:value={title}
							oninput={() => {
								titleTouched = true;
								saveDraft(title, markdown);
							}}
							maxlength="200"
							placeholder="e.g. Deploy notes for Friday"
							autocomplete="off"
							class="machine-well w-full border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
						/>
					</label>

					<label class="flex min-h-0 flex-1 flex-col">
						<span class="mb-1.5 flex items-baseline justify-between text-sm font-medium">
							Markdown
							<span class="font-mono text-xs font-normal text-ink-soft tabular-nums dark:text-slate-500">
								{charCount.toLocaleString()} chars · {kb} KB / 512 KB
							</span>
						</span>
						<textarea
							bind:this={textareaEl}
							value={markdown}
							oninput={onEditorInput}
							onkeydown={onEditorKeyDown}
							rows="6"
							placeholder="# Type or drop a file. Headings, tables, tasks, code."
							spellcheck="false"
							class="machine-well min-h-0 w-full flex-1 resize-y border border-line bg-paper px-3.5 py-3 font-mono text-[13.5px] leading-relaxed placeholder:text-ink-soft/50 focus:border-iris lg:resize-none dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
						></textarea>
					</label>

					<div class="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
						<div class="min-w-0 flex-1">
							<div class="h-1.5 overflow-hidden bg-black/8 dark:bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Size versus 512KB limit">
								<div class="h-full transition-all {overLimit ? 'bg-red-500' : 'bg-iris'}" style="width: {pct}%"></div>
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
							class="inline-flex items-center justify-center border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-iris hover:text-ink dark:border-night-line dark:text-slate-400 dark:hover:text-white"
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
								class="absolute right-0 bottom-full z-50 mb-2 max-h-[60dvh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto border border-line bg-surface p-4 shadow-xl dark:border-night-line dark:bg-night-surface"
							>
								<label class="block">
									<span class="mb-1.5 block text-sm font-medium">Custom slug</span>
									<input
										bind:value={slug}
										maxlength="32"
										placeholder="my-doc-name"
										autocomplete="off"
										spellcheck="false"
										class="w-full border border-line bg-paper px-3 py-2 font-mono text-[13px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
									/>
									<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">a-z, 0-9 and dashes, 3 to 32 long.</span>
								</label>
								{#if slugOk}
									<button
										type="button"
										onclick={copySlugPreview}
										title="Copy slug link"
										class="mt-2 block w-full truncate bg-paper px-2.5 py-1.5 text-left font-mono text-xs text-iris hover:underline dark:bg-night"
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
										class="w-full border border-line bg-paper px-3 py-2 text-sm placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
									/>
									<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">Min 4 characters. Readers type this to open the link.</span>
								</label>
								<div class="mt-3 grid grid-cols-2 gap-3">
									<label class="block">
										<span class="mb-1.5 block text-sm font-medium">Expires</span>
										<select
											bind:value={expiry}
											class="w-full border border-line bg-paper px-2.5 py-2 text-sm focus:border-iris dark:border-night-line dark:bg-night"
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
											class="w-full border border-line bg-paper px-2.5 py-2 text-sm placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
										/>
									</label>
								</div>
								<button
									type="button"
									onclick={closeOptions}
									class="btn-accent mt-4 w-full px-4 py-2 text-sm font-semibold transition"
								>
									Done
								</button>
							</div>
						{/if}
						<button
							onclick={share}
							disabled={!canShare}
							class="btn-accent btn-mag group inline-flex items-center justify-center gap-2 px-6 py-2.5 text-[15px] font-semibold active:scale-[0.98]"
						>
							{#if busy}
								<span class="inline-block size-2 animate-pulse bg-current opacity-70" aria-hidden="true"></span>
								Sharing…
							{:else}
								Share
								<span aria-hidden="true" class="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-1">→</span>
							{/if}
						</button>
					</div>
					</div>
				</div>
			</div>
		</section>
	</div>
</main>

<Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} link={toast?.link ?? null} />
