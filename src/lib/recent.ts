/**
 * Recently viewed — a visitor's own trail through links they followed.
 *
 * Deliberately separate from `shelf.ts`: the shelf is the *owner's* record and
 * holds delete tokens, so it is only ever populated by sharing and only ever
 * meaningful to the sharer. This is the reader's side of the app — it holds no
 * tokens and no capability of any kind, just "where did I just come from", so
 * that losing a link mid-thread (landing on the homepage, closing the tab) does
 * not strand anyone.
 *
 * Client-only, same defensive contract as the shelf: no-ops during SSR and
 * swallows quota errors.
 */

export interface RecentEntry {
	kind: 'doc' | 'bundle';
	id: string;
	slug: string | null;
	title: string;
	at: number;
}

const STORAGE_KEY = 'sharemd-recent';
const MAX_ENTRIES = 12;
/** A trail older than this stops being useful and just becomes noise. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface LooseEntry {
	kind?: unknown;
	id?: unknown;
	slug?: unknown;
	title?: unknown;
	at?: unknown;
}

function normalize(v: unknown): RecentEntry | null {
	if (typeof v !== 'object' || v === null) return null;
	const e = v as LooseEntry;
	if (e.kind !== 'doc' && e.kind !== 'bundle') return null;
	if (typeof e.id !== 'string' || e.id === '') return null;
	if (typeof e.title !== 'string') return null;
	if (typeof e.at !== 'number') return null;
	return {
		kind: e.kind,
		id: e.id,
		slug: typeof e.slug === 'string' && e.slug ? e.slug : null,
		title: e.title,
		at: e.at
	};
}

function load(): RecentEntry[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.map(normalize).filter((e): e is RecentEntry => e !== null);
	} catch {
		return [];
	}
}

function save(entries: RecentEntry[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
	} catch {
		/* best-effort */
	}
}

/** Recent items, newest first, with stale entries and duplicates dropped. */
export function getRecent(): RecentEntry[] {
	const cutoff = Date.now() - MAX_AGE_MS;
	const seen = new Set<string>();
	const out: RecentEntry[] = [];
	for (const e of load()) {
		if (e.at < cutoff) continue;
		const key = `${e.kind}:${e.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(e);
	}
	out.sort((a, b) => b.at - a.at);
	return out.slice(0, MAX_ENTRIES);
}

/**
 * Record that something was just opened. Re-opening moves an entry to the top
 * rather than adding a second copy, so the list stays a trail, not a log.
 */
export function noteViewed(kind: RecentEntry['kind'], id: string, slug: string | null, title: string): void {
	const key = `${kind}:${id}`;
	const rest = load().filter((e) => `${e.kind}:${e.id}` !== key);
	rest.unshift({ kind, id, slug: slug || null, title, at: Date.now() });
	save(rest);
}

/** Forget the whole trail (the Clear control on the home page). */
export function clearRecent(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* best-effort */
	}
}

/**
 * Public path for an entry, used by the home page links.
 * Maps the entry kind onto the actual route prefix — the kinds are 'doc' and
 * 'bundle', but the routes are /s/<id> and /b/<id>.
 */
export function recentHref(e: RecentEntry): string {
	return `${e.kind === 'bundle' ? '/b' : '/s'}/${e.slug ?? e.id}`;
}