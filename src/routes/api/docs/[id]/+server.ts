import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq, or } from 'drizzle-orm';
import {
	deleteDoc,
	gateDoc,
	isCrawlerBot,
	resolveDoc,
	takeView,
	updateDoc,
	verifyDeleteToken,
	type DocGateUpdate
} from '$lib/server/docs';
import { dropDocMemberships } from '$lib/server/bundles';
import { checkRateLimit } from '$lib/server/rate-limit';
import { grantCookieName, verifyGrant } from '$lib/server/grants';
import { hashPassword } from '$lib/server/password';
import { db } from '$lib/server/db';
import { documents } from '$lib/server/db/schema';
import { EXPIRY_ALLOWLIST, SLUG_RE } from '$lib/server/link-gates';
import { cleanInput, renderMarkdown, MAX_MARKDOWN_BYTES } from '$lib/server/markdown';

export const GET: RequestHandler = async ({ params, cookies, request }) => {
	const { id } = params;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	const row = await resolveDoc(id);
	if (!row) return json({ error: 'Not found' }, { status: 404 });

	const gate = gateDoc(row, null);
	// Same contract as the reader page: the password is never accepted from the
	// query string, only an unlock grant cookie satisfies the lock.
	const granted =
		!gate.ok &&
		gate.status === 'locked' &&
		!!row.passwordHash &&
		verifyGrant(row.id, row.passwordHash, cookies.get(grantCookieName(row.id)));

	if (!gate.ok && !granted) {
		if (gate.status === 'gone') return json({ gone: true }, { status: 410 });
		return json({ passwordRequired: true }, { status: 403 });
	}

	// Views increment only on successful serve; the guard makes it atomic.
	// Crawler bots generating link cards do not consume views.
	const isBot = isCrawlerBot(request.headers.get('user-agent'));
	if (!isBot && !(await takeView(row.id))) return json({ gone: true }, { status: 410 });

	return json({
		id: row.id,
		slug: row.slug,
		title: row.title,
		markdown: row.rawMarkdown,
		html: row.html,
		createdAt: row.createdAt,
		views: row.views + 1
	});
};

export const DELETE: RequestHandler = async ({ params, request, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = await checkRateLimit(ip);
	if (!allowed) {
		return json({ error: 'Rate limit exceeded (20/hr)' }, { status: 429 });
	}

	const { id } = params;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const { token } = body as { token?: unknown };

	// Indistinguishable 404: unknown key and pre-token docs (NULL hash) look identical.
	const row = await resolveDoc(id);
	if (!row || !row.deleteTokenHash) return json({ error: 'Not found' }, { status: 404 });

	if (typeof token !== 'string' || !token || !verifyDeleteToken(row, token)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	// Drop bundle membership before the row goes, so no bundle can keep a
	// dangling pointer to a document that no longer exists.
	await dropDocMemberships(row.id);
	await deleteDoc(row.id);
	return json({ deleted: true });
};

export const PUT: RequestHandler = async ({ params, request, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = await checkRateLimit(ip);
	if (!allowed) {
		return json({ error: 'Rate limit exceeded (20/hr)' }, { status: 429 });
	}

	const { id } = params;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { title, markdown, token, password, expiresInSec, maxViews, slug } = (
		body && typeof body === 'object' ? body : {}
	) as {
		title?: unknown;
		markdown?: unknown;
		token?: unknown;
		password?: unknown;
		expiresInSec?: unknown;
		maxViews?: unknown;
		slug?: unknown;
	};

	// Content is optional: editing just the password or expiry must not force the
	// caller to resend the whole document.
	const hasContent = markdown !== undefined;
	if (hasContent && (typeof markdown !== 'string' || !markdown.trim())) {
		return json({ error: 'Markdown must be non-empty' }, { status: 400 });
	}
	if (typeof markdown === 'string' && Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
		return json({ error: 'Markdown exceeds 512KB' }, { status: 413 });
	}

	const row = await resolveDoc(id);
	if (!row || !row.deleteTokenHash) return json({ error: 'Not found' }, { status: 404 });

	if (typeof token !== 'string' || !token || !verifyDeleteToken(row, token)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const gates: DocGateUpdate = {};

	// Password: '' clears an existing lock, anything else must be >= 4 chars.
	// Omitting the key leaves the current setting alone.
	if (password !== undefined) {
		if (password === null || password === '') {
			gates.passwordHash = null;
		} else if (typeof password !== 'string' || cleanInput(password).trim().length < 4) {
			return json({ error: 'password must be at least 4 characters' }, { status: 400 });
		} else {
			gates.passwordHash = hashPassword(cleanInput(password));
		}
	}

	if (expiresInSec !== undefined) {
		if (expiresInSec === null || expiresInSec === 0) {
			gates.expiresAt = null;
		} else if (
			!Number.isInteger(expiresInSec) ||
			!EXPIRY_ALLOWLIST.includes(expiresInSec as number)
		) {
			return json({ error: `expiresInSec must be one of ${EXPIRY_ALLOWLIST.join(', ')}` }, { status: 400 });
		} else {
			gates.expiresAt = Math.floor(Date.now() / 1000) + (expiresInSec as number);
		}
	}

	if (maxViews !== undefined) {
		if (maxViews === null || maxViews === 0) {
			gates.maxViews = null;
		} else if (!Number.isInteger(maxViews) || (maxViews as number) < 1) {
			return json({ error: 'maxViews must be an integer >= 1' }, { status: 400 });
		} else {
			gates.maxViews = maxViews as number;
		}
	}

	if (slug !== undefined) {
		if (slug === null || slug === '') {
			gates.slug = null;
		} else if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
			return json({ error: 'slug must match ^[a-z0-9-]{3,32}$' }, { status: 400 });
		} else {
			const clash = await db
				.select({ id: documents.id })
				.from(documents)
				.where(or(eq(documents.slug, slug), eq(documents.id, slug)))
				.get();
			if (clash && clash.id !== row.id) return json({ error: 'slug taken' }, { status: 409 });
			gates.slug = slug;
		}
	}

	if (!hasContent && Object.keys(gates).length === 0) {
		return json({ error: 'Nothing to update' }, { status: 400 });
	}

	const cleanTitle =
		(typeof title === 'string' && title.trim() ? title : row.title).trim().slice(0, 200);

	// Untouched fields pass through, so a gates-only edit never rewrites content.
	const cleanMd = hasContent ? cleanInput(markdown as string) : row.rawMarkdown;
	const html = hasContent ? await renderMarkdown(cleanMd) : row.html;

	await updateDoc(row.id, cleanTitle, cleanMd, html, gates);

	const slugNow = gates.slug !== undefined ? gates.slug : row.slug;
	return json({
		ok: true,
		id: row.id,
		slug: slugNow,
		title: cleanTitle
	});
};
