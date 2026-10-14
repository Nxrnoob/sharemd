import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { bundleItems, bundles, documents, type Bundle } from './db/schema';
import { gateDoc, resolveDoc, type Gate } from './docs';
import { verifyPassword } from './password';

export type BundleGate = Gate;

/** Resolve by slug first, then by id — same shadowing rule as `resolveDoc`. */
export async function resolveBundle(key: string): Promise<Bundle | undefined> {
	return (
		(await db.select().from(bundles).where(eq(bundles.slug, key)).get()) ??
		(await db.select().from(bundles).where(eq(bundles.id, key)).get())
	);
}

/** Enforcement order: expired → exhausted → password. No content revealed. */
export function gateBundle(bundle: Bundle, pw: string | null): BundleGate {
	const nowSec = Math.floor(Date.now() / 1000);
	if (bundle.expiresAt !== null && bundle.expiresAt < nowSec) {
		return { ok: false, status: 'gone', reason: 'expired' };
	}
	if (bundle.maxViews !== null && bundle.views >= bundle.maxViews) {
		return { ok: false, status: 'gone', reason: 'exhausted' };
	}
	if (bundle.passwordHash) {
		if (!pw || !verifyPassword(pw, bundle.passwordHash)) return { ok: false, status: 'locked' };
	}
	return { ok: true };
}

/**
 * Atomic take-a-view. The WHERE guard makes the increment itself the race check,
 * exactly as `takeView` does for documents.
 */
export async function takeBundleView(bundleId: string): Promise<boolean> {
	const res = await db.run(
		sql`UPDATE bundles SET views = views + 1 WHERE id = ${bundleId} AND (max_views IS NULL OR views < max_views)`
	);
	return res.rowsAffected > 0;
}

/** Constant-time bundle-token check. Never throws. */
export function verifyBundleToken(bundle: Bundle, token: string): boolean {
	if (!bundle.deleteTokenHash) return false;
	return verifyPassword(token, bundle.deleteTokenHash);
}

export interface BundleMember {
	id: string;
	title: string;
	slug: string | null;
	href: string;
	createdAt: number;
	readMins: number;
	/** Per-member state. Members are ungated at creation, but one can still
	 *  expire or run out of views afterwards — the index reports that honestly
	 *  instead of rendering a link to a dead page. */
	gone: 'expired' | 'exhausted' | null;
}

/**
 * Members in frozen creator order, with per-member gate state resolved.
 * A doc deleted since the bundle was made simply drops out — membership is a
 * join row, so shrinking is the only way a member can disappear.
 */
export async function getBundleMembers(bundleId: string): Promise<BundleMember[]> {
	const rows = await db
		.select({ docId: bundleItems.docId, position: bundleItems.position })
		.from(bundleItems)
		.where(eq(bundleItems.bundleId, bundleId))
		.orderBy(asc(bundleItems.position))
		.all();

	if (rows.length === 0) return [];

	const docs = await db
		.select()
		.from(documents)
		.where(inArray(documents.id, rows.map((r) => r.docId)))
		.all();
	const byId = new Map(docs.map((d) => [d.id, d]));

	const nowSec = Math.floor(Date.now() / 1000);
	const out: BundleMember[] = [];
	for (const row of rows) {
		const doc = byId.get(row.docId);
		if (!doc) continue; // deleted since bundling — drops out, never ghosts
		const gate = gateDoc(doc, null);
		const gone = !gate.ok && gate.status === 'gone' ? gate.reason : null;
		const words = doc.rawMarkdown.trim().split(/\s+/).filter(Boolean).length;
		out.push({
			id: doc.id,
			title: doc.title,
			slug: doc.slug,
			href: `/s/${doc.slug ?? doc.id}`,
			createdAt: doc.createdAt,
			readMins: Math.max(1, Math.ceil(words / 200)),
			gone
		});
	}
	return out;
}

/**
 * Delete a bundle and its membership rows. Members themselves survive — a
 * bundle is a snapshot of links, not ownership of the docs behind them. Every
 * member keeps working at its own /s/<id>.
 *
 * The bundle row goes first because that is the operation that was actually
 * requested. Membership cleanup is best-effort: if it fails, the leftover rows
 * are keyed by a bundle id that no longer exists, and every read of membership
 * is filtered by bundle id, so they are inert rather than corrupting.
 */
export async function deleteBundle(bundleId: string): Promise<boolean> {
	const res = await db.delete(bundles).where(eq(bundles.id, bundleId)).run();
	try {
		await db.delete(bundleItems).where(eq(bundleItems.bundleId, bundleId)).run();
	} catch {
		/* orphaned membership rows are inert — see above */
	}
	return res.rowsAffected > 0;
}

/**
 * Drop a deleted doc's membership rows. Called from the doc delete path.
 *
 * Best-effort by design, and this matters: membership is bookkeeping layered
 * on top of document deletion, so a failure here must never take down the
 * delete the user actually asked for. `getBundleMembers` already skips ids
 * that no longer resolve to a document, so stale rows are inert. This is what
 * keeps the endpoint working on a database where the migration has not been
 * applied yet, instead of 500-ing on a housekeeping query.
 */
export async function dropDocMemberships(docId: string): Promise<void> {
	try {
		await db.delete(bundleItems).where(eq(bundleItems.docId, docId)).run();
	} catch {
		/* see above */
	}
}

/**
 * Prove ownership of every member before a bundle may reference it.
 *
 * This is the whole security basis of the feature. Without it, anyone could
 * POST an arbitrary list of doc ids and mint a bundle whose token deletes other
 * people's documents. Holding the delete token is the only proof accepted, and
 * the caller is the browser that already holds those tokens in its shelf.
 */
export async function verifyMemberOwnership(
	members: { docId: string; token: string }[]
): Promise<{ ok: true } | { ok: false; docId: string; reason: 'unknown' | 'bad-token' }> {
	for (const m of members) {
		const doc = await resolveDoc(m.docId);
		// Same indistinguishability as the delete endpoint: unknown key and
		// pre-token doc (NULL hash) are the same answer.
		if (!doc || !doc.deleteTokenHash) return { ok: false, docId: m.docId, reason: 'unknown' };
		if (!verifyPassword(m.token, doc.deleteTokenHash)) {
			return { ok: false, docId: m.docId, reason: 'bad-token' };
		}
	}
	return { ok: true };
}

/**
 * Members must be ungated at creation. A bundle gate that disagrees with a
 * member gate produces the worst possible outcome — a recipient unlocks the
 * index, then hits a password screen inside. One gate governs the whole share.
 */
export async function findGatedMember(
	docIds: string[]
): Promise<{ docId: string; gate: 'password' | 'expires' | 'views' } | undefined> {
	if (docIds.length === 0) return undefined;
	const docs = await db
		.select()
		.from(documents)
		.where(inArray(documents.id, docIds))
		.all();
	const byId = new Map(docs.map((d) => [d.id, d]));
	for (const id of docIds) {
		const doc = byId.get(id);
		if (!doc) continue; // ownership check already rejected unknown ids
		if (doc.passwordHash) return { docId: id, gate: 'password' };
		if (doc.expiresAt !== null) return { docId: id, gate: 'expires' };
		if (doc.maxViews !== null) return { docId: id, gate: 'views' };
	}
	return undefined;
}