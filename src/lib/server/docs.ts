import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { documents, type Document } from './db/schema';
import { verifyPassword } from './password';

export type Gate =
	| { ok: true }
	| { ok: false; status: 'gone'; reason: 'expired' | 'exhausted' }
	| { ok: false; status: 'locked' };

/** Resolve by slug first, then by id (slugs can never equal an id: enforced at POST). */
export async function resolveDoc(key: string): Promise<Document | undefined> {
	return (
		(await db.select().from(documents).where(eq(documents.slug, key)).get()) ??
		(await db.select().from(documents).where(eq(documents.id, key)).get())
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
export async function takeView(docId: string): Promise<boolean> {
	const res = await db.run(
		sql`UPDATE documents SET views = views + 1 WHERE id = ${docId} AND (max_views IS NULL OR views < max_views)`
	);
	return res.rowsAffected > 0;
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
export async function deleteDoc(docId: string): Promise<boolean> {
	const res = await db.delete(documents).where(eq(documents.id, docId)).run();
	return res.rowsAffected > 0;
}

/** Optional link gates. A key left undefined is not touched, so callers can
 *  change the expiry without restating the password and vice versa. `password`
 *  is the odd one out: pass '' to clear an existing lock. */
export type DocGateUpdate = {
	slug?: string | null;
	passwordHash?: string | null;
	expiresAt?: number | null;
	maxViews?: number | null;
};

/**
 * Update a doc's title, markdown and rendered HTML by id. Returns true when updated.
 * `gates` is applied in the same statement so title/markdown edits and link-settings
 * changes never need two round trips.
 */
export async function updateDoc(
	docId: string,
	title: string,
	rawMarkdown: string,
	html: string,
	gates?: DocGateUpdate
): Promise<boolean> {
	const set: Partial<Document> = { title, rawMarkdown, html };
	if (gates) {
		if (gates.slug !== undefined) set.slug = gates.slug;
		if (gates.passwordHash !== undefined) set.passwordHash = gates.passwordHash;
		if (gates.expiresAt !== undefined) set.expiresAt = gates.expiresAt;
		if (gates.maxViews !== undefined) set.maxViews = gates.maxViews;
	}
	const res = await db.update(documents).set(set).where(eq(documents.id, docId)).run();
	return res.rowsAffected > 0;
}

const BOT_UA_REGEX =
	/bot|spider|crawl|slurp|facebookexternalhit|whatsapp|telegrambot|slackbot|discordbot|applebot|twitterbot|linkedinbot|embedly|quora link preview|pinterest|skypeuripreview/i;

/** Returns true if user-agent matches known link preview scrapers or search bots. */
export function isCrawlerBot(userAgent: string | null | undefined): boolean {
	if (!userAgent) return false;
	return BOT_UA_REGEX.test(userAgent);
}
