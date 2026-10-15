import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { eq, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bundleItems, bundles, documents } from '$lib/server/db/schema';
import { findGatedMember, verifyMemberOwnership } from '$lib/server/bundles';
import { cleanInput } from '$lib/server/markdown';
import { hashPassword } from '$lib/server/password';
import { checkRateLimit } from '$lib/server/rate-limit';
import { EXPIRY_ALLOWLIST, SLUG_RE } from '$lib/server/link-gates';
import { isThemeId } from '$lib/themes';

const MAX_MEMBERS = 50;

interface MemberInput {
	docId: string;
	token: string;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = await checkRateLimit(ip);
	if (!allowed) {
		return json({ error: 'Rate limit exceeded (20/hr)' }, { status: 429 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { title, docs, slug, password, expiresInSec, maxViews, theme } = body as {
		title?: unknown;
		docs?: unknown;
		slug?: unknown;
		password?: unknown;
		expiresInSec?: unknown;
		maxViews?: unknown;
		theme?: unknown;
	};

	if (typeof title !== 'string' || !Array.isArray(docs)) {
		return json({ error: 'title must be a string and docs must be an array' }, { status: 400 });
	}

	const cleanTitle = cleanInput(title).trim().slice(0, 200);
	if (!cleanTitle) return json({ error: 'title must be non-empty' }, { status: 400 });

	if (docs.length === 0) return json({ error: 'a bundle needs at least one doc' }, { status: 400 });
	if (docs.length > MAX_MEMBERS) {
		return json({ error: `a bundle holds at most ${MAX_MEMBERS} docs` }, { status: 400 });
	}

	const members: MemberInput[] = [];
	const seen = new Set<string>();
	for (const raw of docs as unknown[]) {
		const d = raw as { docId?: unknown; token?: unknown };
		if (typeof d?.docId !== 'string' || typeof d?.token !== 'string') {
			return json({ error: 'each doc needs a docId and a token' }, { status: 400 });
		}
		const id = d.docId.trim();
		if (!id) return json({ error: 'docId must be non-empty' }, { status: 400 });
		if (seen.has(id)) continue; // dedupe, keeping first position
		seen.add(id);
		members.push({ docId: id, token: d.token });
	}

	// Ownership first: a bundle must never reference a doc the caller cannot prove.
	const owned = await verifyMemberOwnership(members);
	if (!owned.ok) {
		return json(
			{
				error:
					owned.reason === 'unknown'
						? 'One of those docs no longer exists.'
						: 'You do not own one of those docs. Refresh and try again.'
			},
			{ status: 403 }
		);
	}

	// Gated members are rejected rather than silently overridden — see findGatedMember.
	const gated = await findGatedMember(members.map((m) => m.docId));
	if (gated) {
		const why =
			gated.gate === 'password'
				? 'a password'
				: gated.gate === 'expires'
					? 'an expiry'
					: 'a view limit';
		return json(
			{ error: `One of those docs has ${why}. Remove that gate, or bundle it on its own.` },
			{ status: 409 }
		);
	}

	let slugVal: string | null = null;
	if (slug !== undefined) {
		if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
			return json({ error: 'slug must match ^[a-z0-9-]{3,32}$' }, { status: 400 });
		}
		// /b/ and /s/ are separate namespaces, so a clash would not break
		// resolution — but two different things answering to one word is a trap
		// for humans, so refuse across both tables.
		const docClash = await db
			.select({ id: documents.id })
			.from(documents)
			.where(or(eq(documents.slug, slug), eq(documents.id, slug)))
			.get();
		const bundleClash = await db
			.select({ id: bundles.id })
			.from(bundles)
			.where(or(eq(bundles.slug, slug), eq(bundles.id, slug)))
			.get();
		if (docClash || bundleClash) return json({ error: 'slug taken' }, { status: 409 });
		slugVal = slug;
	}

	let passwordHash: string | null = null;
	if (password !== undefined) {
		if (typeof password !== 'string' || cleanInput(password).length < 4) {
			return json({ error: 'password must be at least 4 characters' }, { status: 400 });
		}
		passwordHash = hashPassword(cleanInput(password));
	}

	let expiresAt: number | null = null;
	if (expiresInSec !== undefined) {
		if (!Number.isInteger(expiresInSec) || !EXPIRY_ALLOWLIST.includes(expiresInSec as number)) {
			return json(
				{ error: 'expiresInSec must be one of 3600, 86400, 604800, 2592000' },
				{ status: 400 }
			);
		}
		expiresAt = Math.floor(Date.now() / 1000) + (expiresInSec as number);
	}

	let maxViewsVal: number | null = null;
	if (maxViews !== undefined) {
		if (!Number.isInteger(maxViews) || (maxViews as number) < 1) {
			return json({ error: 'maxViews must be an integer >= 1' }, { status: 400 });
		}
		maxViewsVal = maxViews as number;
	}

	let themeVal: string | null = null;
	if (theme !== undefined && theme !== null && theme !== '') {
		// Validated against the shipped theme list rather than trusted, so a
		// hand-rolled POST cannot pin the folder page to a colourway that does not
		// exist and render it with unstyled fallbacks.
		if (!isThemeId(theme)) {
			return json({ error: 'unknown theme' }, { status: 400 });
		}
		themeVal = theme;
	}

	const id = nanoid(8);
	// Capability token, identical discipline to documents: 32 random bytes,
	// scrypt-hashed at rest, plaintext returned exactly once.
	const deleteToken = randomBytes(32).toString('hex');
	const deleteTokenHash = hashPassword(deleteToken);

	await db.insert(bundles)
		.values({
			id,
			title: cleanTitle,
			slug: slugVal,
			createdAt: Date.now(),
			views: 0,
			passwordHash,
			deleteTokenHash,
			expiresAt,
			maxViews: maxViewsVal,
			theme: themeVal
		})
		.run();

	await db
		.insert(bundleItems)
		.values(members.map((m, i) => ({ bundleId: id, docId: m.docId, position: i })))
		.run();

	return json(
		{ id, slug: slugVal, url: slugVal ? `/b/${slugVal}` : `/b/${id}`, deleteToken },
		{ status: 201 }
	);
};