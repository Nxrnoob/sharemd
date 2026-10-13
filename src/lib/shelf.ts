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
	/**
	 * Folder this doc is filed under, or null for uncategorised.
	 * Deliberately optional: shelves written before folders existed have no
	 * `folder` key and must keep loading unchanged — that is the whole
	 * migration story. There is no server-side owner to attach a folder to
	 * (ownership is proven per-document by the token above), so folders are
	 * local metadata layered over the shelf, not a column on `documents`.
	 */
	folder?: string | null;
}

/** A user-created folder. Single-level by design — see docs in /library. */
export interface Folder {
	id: string;
	name: string;
	createdAt: number;
}

const STORAGE_KEY = 'sharemd-shelf';
const FOLDERS_KEY = 'sharemd-folders';
const MAX_ENTRIES = 100;
const MAX_FOLDERS = 50;
const MAX_FOLDER_NAME = 40;

interface LooseEntry {
	id?: unknown;
	slug?: unknown;
	title?: unknown;
	token?: unknown;
	createdAt?: unknown;
	folder?: unknown;
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
		createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : 0,
		// Absent (pre-folders shelf) and garbage both land on null = uncategorised.
		folder: typeof e.folder === 'string' && e.folder !== '' ? e.folder : null
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

/** Return the delete/edit token for an owned doc id, or null if not owned. */
export function getOwnedToken(id: string): string | null {
	return load().find((e) => e.id === id)?.token ?? null;
}

/** Update the title of an owned doc on the shelf. */
export function updateShelfTitle(id: string, newTitle: string): void {
	const entries = load();
	const target = entries.find((e) => e.id === id);
	if (target) {
		target.title = newTitle;
		save(entries);
	}
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

/* ---------------------------------------------------------------- folders */

/**
 * Folders are local metadata over the shelf, stored under their own key so a
 * corrupt or full folder list can never cost you your delete tokens (and
 * therefore ownership of your docs). Same defensive contract as the shelf:
 * every helper no-ops during SSR and swallows quota errors.
 *
 * Deliberately single-level. At the shelf's 100-entry ceiling a hierarchy is
 * tree UI without the payoff, and drag-to-nest is fiddly; `parentId` can be
 * added later without a storage migration if that ever changes.
 */

interface LooseFolder {
	id?: unknown;
	name?: unknown;
	createdAt?: unknown;
}

/** randomUUID where available; a collision-resistant fallback otherwise. */
function newFolderId(): string {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
	} catch {
		/* fall through to the manual id */
	}
	return `f_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Trim + clamp + reject blanks. Returns '' when unusable. */
function cleanFolderName(name: string): string {
	if (typeof name !== 'string') return '';
	return name.trim().replace(/\s+/g, ' ').slice(0, MAX_FOLDER_NAME);
}

function normalizeFolder(v: unknown): Folder | null {
	if (typeof v !== 'object' || v === null) return null;
	const f = v as LooseFolder;
	if (typeof f.id !== 'string' || f.id === '') return null;
	if (typeof f.name !== 'string') return null;
	const name = cleanFolderName(f.name);
	if (!name) return null;
	return {
		id: f.id,
		name,
		createdAt: typeof f.createdAt === 'number' && Number.isFinite(f.createdAt) ? f.createdAt : 0
	};
}

function loadFolders(): Folder[] {
	try {
		if (typeof localStorage === 'undefined') return [];
		const raw = localStorage.getItem(FOLDERS_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: Folder[] = [];
		const seen = new Set<string>();
		for (const v of parsed) {
			const f = normalizeFolder(v);
			// First wins on duplicate ids — a duplicate would otherwise split
			// one folder's docs across two sidebar rows.
			if (f && !seen.has(f.id)) {
				seen.add(f.id);
				out.push(f);
			}
		}
		return out;
	} catch {
		return [];
	}
}

function saveFolders(folders: Folder[]): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
	} catch {
		/* private mode / quota */
	}
}

/** All folders, oldest first. Never throws. */
export function getFolders(): Folder[] {
	return loadFolders();
}

/** Create a folder. Returns null if the name is blank, a case-insensitive
 *  duplicate, or the 50-folder cap is hit. */
export function createFolder(name: string): Folder | null {
	const clean = cleanFolderName(name);
	if (!clean) return null;
	const folders = loadFolders();
	if (folders.some((f) => f.name.toLowerCase() === clean.toLowerCase())) return null;
	if (folders.length >= MAX_FOLDERS) return null;
	const folder: Folder = { id: newFolderId(), name: clean, createdAt: Date.now() };
	saveFolders([...folders, folder]);
	return folder;
}

/** Rename in place. Returns false on a blank/duplicate name or unknown id. */
export function renameFolder(id: string, name: string): boolean {
	const clean = cleanFolderName(name);
	if (!clean) return false;
	const folders = loadFolders();
	if (!folders.some((f) => f.id === id)) return false;
	if (folders.some((f) => f.id !== id && f.name.toLowerCase() === clean.toLowerCase())) return false;
	saveFolders(folders.map((f) => (f.id === id ? { ...f, name: clean } : f)));
	return true;
}

/**
 * Delete a folder. Docs inside it are orphaned, never deleted — they fall back
 * to uncategorised so losing a folder can never lose work.
 */
export function deleteFolder(id: string): void {
	saveFolders(loadFolders().filter((f) => f.id !== id));
	const entries = load();
	const next = entries.map((e) => (e.folder === id ? { ...e, folder: null } : e));
	if (next.some((e, i) => e !== entries[i])) save(next);
}

/**
 * File a doc under a folder, or pass null to unfile it. An unknown folder id is
 * coerced to null so the shelf can never accumulate dangling references (the
 * 100-entry shelf cap evicts docs independently of folders).
 */
export function setDocFolder(docId: string, folderId: string | null): void {
	const resolved =
		folderId && loadFolders().some((f) => f.id === folderId) ? folderId : null;
	const entries = load();
	const next = entries.map((e) => (e.id === docId ? { ...e, folder: resolved } : e));
	if (next.some((e, i) => e !== entries[i])) save(next);
}
