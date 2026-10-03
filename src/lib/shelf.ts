/**
 * Silent-token shelf: records of docs shared from THIS browser.
 *
 * On a successful share the server returns a one-time `deleteToken`;
 * the client stores `{id, slug, title, token, createdAt}` in localStorage
 * under `sharemd-shelf`, silently, with no UI mention of tokens, ever.
 * Ownership (showing a delete affordance) is proven purely by holding
 * the token locally. Tokens are never rendered; they only travel in
 * the body of a DELETE request.
 *
 * Client-only: every helper no-ops safely during SSR and in private
 * mode (quota errors are swallowed, the shelf is best-effort).
 */

export interface ShelfEntry {
	id: string;
	slug: string | null;
	title: string;
	token: string;
	createdAt: number;
}

const STORAGE_KEY = 'sharemd-shelf';
const MAX_ENTRIES = 100;

interface LooseEntry {
	id?: unknown;
	slug?: unknown;
	title?: unknown;
	token?: unknown;
	createdAt?: unknown;
}

function normalize(v: unknown): ShelfEntry | null {
	if (typeof v !== 'object' || v === null) return null;
	const e = v as LooseEntry;
	if (typeof e.id !== 'string' || e.id === '') return null;
	if (typeof e.token !== 'string' || e.token === '') return null;
	return {
		id: e.id,
		slug: typeof e.slug === 'string' && e.slug !== '' ? e.slug : null,
		title: typeof e.title === 'string' && e.title !== '' ? e.title : 'Untitled',
		token: e.token,
		createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : 0
	};
}

function load(): ShelfEntry[] {
	try {
		if (typeof localStorage === 'undefined') return [];
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: ShelfEntry[] = [];
		for (const v of parsed) {
			const e = normalize(v);
			if (e) out.push(e);
		}
		return out;
	} catch {
		return [];
	}
}

function save(entries: ShelfEntry[]): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		/* private mode / quota: shelf stays best-effort */
	}
}

/** All shelf entries, newest first. Never throws. */
export function getShelf(): ShelfEntry[] {
	return load();
}

/** True when this browser holds the delete token for the id. */
export function owns(id: string): boolean {
	return load().some((e) => e.id === id);
}

/** Record a share. Dedupes by id, newest first, capped at 100. */
export function addToShelf(entry: ShelfEntry): void {
	const rest = load().filter((e) => e.id !== entry.id);
	rest.unshift(entry);
	save(rest.slice(0, MAX_ENTRIES));
}

/** Forget a share (after delete, or when the token is spent). */
export function removeFromShelf(id: string): void {
	save(load().filter((e) => e.id !== id));
}

export type DeleteResult = 'deleted' | 'forbidden' | 'missing' | 'failed';

/**
 * Delete an owned doc. Status-driven per the API contract:
 * 200 → deleted, 403 → forbidden, 404 → missing, anything else → failed.
 */
export async function deleteOwnedDoc(id: string, token: string): Promise<DeleteResult> {
	try {
		const res = await fetch(`/api/docs/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token })
		});
		if (res.status === 200) return 'deleted';
		if (res.status === 403) return 'forbidden';
		if (res.status === 404) return 'missing';
		return 'failed';
	} catch {
		return 'failed';
	}
}
