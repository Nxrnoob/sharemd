import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { documents, type Document } from './db/schema';
import { verifyPassword } from './password';

export type Gate =
	| { ok: true }
	| { ok: false; status: 'gone'; reason: 'expired' | 'exhausted' }
	| { ok: false; status: 'locked' };

/** Resolve by slug first, then by id (slugs can never equal an id: enforced at POST). */
export function resolveDoc(key: string): Document | undefined {
	return (
		db.select().from(documents).where(eq(documents.slug, key)).get() ??
		db.select().from(documents).where(eq(documents.id, key)).get()
	);
}

/** Enforcement order: expired → exhausted → password. No content is revealed here. */
export function gateDoc(doc: Document, pw: string | null): Gate {
	const nowSec = Math.floor(Date.now() / 1000);
	if (doc.expiresAt !== null && doc.expiresAt < nowSec) {
		return { ok: false, status: 'gone', reason: 'expired' };
	}
	if (doc.maxViews !== null && doc.views >= doc.maxViews) {
		return { ok: false, status: 'gone', reason: 'exhausted' };
	}
	if (doc.passwordHash) {
		if (!pw || !verifyPassword(pw, doc.passwordHash)) return { ok: false, status: 'locked' };
	}
	return { ok: true };
}

/**
 * Atomic take-a-view. The WHERE guard makes the increment itself the
 * race check: false means another request took the last view — treat as exhausted.
 */
export function takeView(docId: string): boolean {
	const res = db.run(
		sql`UPDATE documents SET views = views + 1 WHERE id = ${docId} AND (max_views IS NULL OR views < max_views)`
	);
	return res.changes > 0;
}

/**
 * Constant-time delete-token check. False when the doc predates
 * delete tokens (NULL hash) or the token mismatches. Never throws.
 */
export function verifyDeleteToken(doc: Document, token: string): boolean {
	if (!doc.deleteTokenHash) return false;
	return verifyPassword(token, doc.deleteTokenHash);
}

/** Hard-delete a doc row by id. Returns true when a row was removed. */
export function deleteDoc(docId: string): boolean {
	const res = db.delete(documents).where(eq(documents.id, docId)).run();
	return res.changes > 0;
}
