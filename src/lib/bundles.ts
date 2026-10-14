/**
 * Client-side bundle shelf: the silent-token record of folder shares made
 * from THIS browser, plus the create/delete calls.
 *
 * Same defensive contract as `shelf.ts` — every helper no-ops during SSR and
 * swallows quota errors, and the delete token never appears in any UI. Holding
 * the token is what proves ownership of the bundle link, exactly as it does for
 * a doc.
 */

import { getShelf } from './shelf';

export interface BundleEntry {
	id: string;
	slug: string | null;
	title: string;
	token: string;
	createdAt: number;
	/** Doc ids frozen into this snapshot, for display only. */
	docIds: string[];
}

const STORAGE_KEY = 'sharemd-bundles';
const MAX_ENTRIES = 100;

interface LooseBundle {
	id?: unknown;
	slug?: unknown;
	title?: unknown;
	token?: unknown;
	createdAt?: unknown;
	docIds?: unknown;
}

function normalize(v: unknown): BundleEntry | null {
	if (typeof v !== 'object' || v === null) return null;
	const b = v as LooseBundle;
	if (typeof b.id !== 'string' || b.id === '') return null;
	if (typeof b.token !== 'string' || b.token === '') return null;
	if (typeof b.title !== 'string') return null;
	return {
		id: b.id,
		slug: typeof b.slug === 'string' && b.slug ? b.slug : null,
		title: b.title,
		token: b.token,
		createdAt: typeof b.createdAt === 'number' ? b.createdAt : 0,
		docIds: Array.isArray(b.docIds) ? b.docIds.filter((d): d is string => typeof d === 'string') : []
	};
}

function load(): BundleEntry[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.map(normalize).filter((b): b is BundleEntry => b !== null);
	} catch {
		return [];
	}
}

function save(entries: BundleEntry[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
	} catch {
		/* best-effort; the share itself already succeeded */
	}
}

/** Every bundle shared from this browser, newest first. */
export function getBundles(): BundleEntry[] {
	return load();
}

export function addBundle(entry: BundleEntry): void {
	const rest = load().filter((b) => b.id !== entry.id);
	rest.unshift(entry);
	save(rest);
}

export function removeBundle(id: string): void {
	save(load().filter((b) => b.id !== id));
}

/**
 * Docs filed under `folderId` that this browser can prove ownership of, in
 * shelf order. The server re-verifies every one of these tokens before it will
 * mint a bundle — this list is a convenience, not the proof.
 */
export function folderMembers(folderId: string): { docId: string; token: string }[] {
	return getShelf()
		.filter((e) => e.folder === folderId)
		.map((e) => ({ docId: e.id, token: e.token }));
}

export type CreateBundleResult =
	| { ok: true; id: string; slug: string | null; url: string; deleteToken: string; docIds: string[] }
	| { ok: false; error: string };

/** Create a bundle from the docs currently filed in a folder. */
export async function createBundleForFolder(
	folderId: string,
	title: string
): Promise<CreateBundleResult> {
	const docs = folderMembers(folderId);
	if (docs.length === 0) return { ok: false, error: 'That folder has no docs to share.' };

	try {
		const res = await fetch('/api/bundles', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title, docs })
		});
		const out = (await res.json().catch(() => ({}))) as unknown;
		const body =
			out && typeof out === 'object'
				? (out as { id?: unknown; slug?: unknown; url?: unknown; deleteToken?: unknown; error?: unknown })
				: {};

		if (!res.ok) {
			const msg =
				typeof body.error === 'string'
					? body.error
					: res.status === 429
						? 'Rate limit exceeded. Try again later.'
						: 'Could not share that folder.';
			return { ok: false, error: msg };
		}
		if (typeof body.id !== 'string' || !body.id || typeof body.deleteToken !== 'string') {
			return { ok: false, error: 'Server sent an unexpected reply.' };
		}

		const slug = typeof body.slug === 'string' && body.slug ? body.slug : null;
		const url = typeof body.url === 'string' && body.url ? body.url : `/b/${body.id}`;

		addBundle({
			id: body.id,
			slug,
			title,
			token: body.deleteToken,
			createdAt: Date.now(),
			docIds: docs.map((d) => d.docId)
		});

		return { ok: true, id: body.id, slug, url, deleteToken: body.deleteToken, docIds: docs.map((d) => d.docId) };
	} catch {
		return { ok: false, error: 'Could not reach the server. Check your connection.' };
	}
}

export type DeleteBundleResult = 'deleted' | 'forbidden' | 'missing' | 'failed';

/** Delete a bundle link. Member docs are untouched and keep working. */
export async function deleteBundleRemote(id: string, token: string): Promise<DeleteBundleResult> {
	try {
		const res = await fetch(`/api/bundles/${encodeURIComponent(id)}`, {
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