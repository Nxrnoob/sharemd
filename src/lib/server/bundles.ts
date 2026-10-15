import { asc, and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { bundleItems, bundles, documents, type Bundle } from './db/schema';
import { deleteDoc, gateDoc, resolveDoc, type Gate } from './docs';
import { hashPassword, verifyPassword } from './password';

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
	/** Display name for a doc someone else added; null for docs the bundle
	 *  creator included, which are attributed to the share rather than a person. */
	contributorName: string | null;
	/** Per-member state. Members are ungated at creation, but one can still
	 *  expire or run out of views afterwards — the index reports that honestly
	 *  instead of rendering a link to a dead page. */
	gone: 'expired' | 'exhausted' | null;
}

/**
 * Members in frozen creator order, with per-member gate state resolved. Docs
 * contributed later append to the end, so the creator's ordering is never
 * disturbed by anyone else adding to the folder.
 * A doc deleted since the bundle was made simply drops out — membership is a
 * join row, so shrinking is the only way a member can disappear.
 */
export async function getBundleMembers(bundleId: string): Promise<BundleMember[]> {
	const rows = await db
		.select({
			docId: bundleItems.docId,
			position: bundleItems.position,
			contributorName: bundleItems.contributorName
		})
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
			contributorName: row.contributorName,
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

/**
 * Ceiling on a bundle's membership once contributions are in play. Creation caps
 * at 50, but contributions accumulate over the life of a link rather than being
 * chosen once, so they get more headroom — still bounded, because an unbounded
 * list is both a spam target and a slow page for every reader.
 */
export const MAX_MEMBERS_WITH_CONTRIBUTIONS = 200;

/**
 * Append a doc to a bundle on behalf of someone holding the folder password.
 *
 * Append-only by construction: the returned capability token is minted for the
 * new document alone, and that token is the only thing the rest of the system
 * accepts as proof of authority over a doc. A contributor therefore cannot edit
 * or delete anything they did not create, and neither can the bundle creator
 * (who holds no token for a contribution they never made).
 *
 * The doc is created ungated, matching the rule that one bundle gate governs the
 * whole share — a member carrying its own password would leave readers unlocking
 * the index and then hitting a second lock inside it.
 */
export async function contributeDoc(
	bundleId: string,
	title: string,
	rawMarkdown: string,
	html: string,
	contributorName: string | null
): Promise<{ ok: true; docId: string; deleteToken: string } | { ok: false; reason: 'full' }> {
	const stats = await db
		.select({
			count: sql<number>`count(*)`,
			maxPos: sql<number>`coalesce(max(${bundleItems.position}), -1)`
		})
		.from(bundleItems)
		.where(eq(bundleItems.bundleId, bundleId))
		.get();

	if ((stats?.count ?? 0) >= MAX_MEMBERS_WITH_CONTRIBUTIONS) return { ok: false, reason: 'full' };

	const docId = nanoid(8);
	// Same capability discipline as every other doc: 32 random bytes, scrypt at
	// rest, plaintext handed back exactly once so the contributor can manage
	// their own file and nothing else.
	const deleteToken = randomBytes(32).toString('hex');

	await db
		.insert(documents)
		.values({
			id: docId,
			title,
			rawMarkdown,
			html,
			createdAt: Date.now(),
			views: 0,
			slug: null,
			passwordHash: null,
			deleteTokenHash: hashPassword(deleteToken),
			expiresAt: null,
			maxViews: null
		})
		.run();

	await db
		.insert(bundleItems)
		.values({
			bundleId,
			docId,
			// Appended, so the creator's frozen ordering is never disturbed.
			position: (stats?.maxPos ?? -1) + 1,
			contributorName
		})
		.run();

	return { ok: true, docId, deleteToken };
}

/**
 * List the docs other people added to a folder, for the creator's own Library.
 *
 * Only contributions are returned. The creator's original members are already
 * in their Library under their own delete tokens, so surfacing them here too
 * would duplicate rows and imply the removal route could reach them — it
 * deliberately cannot.
 */
export async function listContributedMembers(
	bundleId: string
): Promise<{ docId: string; title: string; contributorName: string; createdAt: number }[]> {
	const rows = await db
		.select({ docId: bundleItems.docId, contributorName: bundleItems.contributorName })
		.from(bundleItems)
		.where(and(eq(bundleItems.bundleId, bundleId), sql`${bundleItems.contributorName} is not null`))
		.orderBy(asc(bundleItems.position))
		.all();
	if (rows.length === 0) return [];

	const docs = await db
		.select({ id: documents.id, title: documents.title, createdAt: documents.createdAt })
		.from(documents)
		.where(inArray(documents.id, rows.map((r) => r.docId)))
		.all();
	const byId = new Map(docs.map((d) => [d.id, d]));

	return rows.flatMap((r) => {
		const doc = byId.get(r.docId);
		// A deleted contribution drops out rather than showing as a dead row.
		if (!doc || !r.contributorName) return [];
		return [{ docId: doc.id, title: doc.title, contributorName: r.contributorName, createdAt: doc.createdAt }];
	});
}

/**
 * Remove a contributed doc using the bundle's own delete token.
 *
 * Deliberately scoped to contributions only: a doc the creator put in stays
 * theirs, managed from their Library, so this can never become a way to delete
 * somebody else's work. The membership row is dropped first, because a doc left
 * behind with no membership row would be invisible but still live on its own
 * /s/<id> link.
 */
export async function removeContributedMember(
	bundle: Bundle,
	docId: string
): Promise<{ ok: true } | { ok: false; reason: 'unknown' | 'not-a-contribution' | 'failed' }> {
	const item = await db
		.select({ contributorName: bundleItems.contributorName })
		.from(bundleItems)
		.where(and(eq(bundleItems.bundleId, bundle.id), eq(bundleItems.docId, docId)))
		.get();

	if (!item) return { ok: false, reason: 'unknown' };
	if (!item.contributorName) return { ok: false, reason: 'not-a-contribution' };

	const doc = await resolveDoc(docId);
	if (doc) await deleteDoc(docId);
	return { ok: true };
}