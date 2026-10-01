import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import { eq, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { documents } from '$lib/server/db/schema';
import { MAX_MARKDOWN_BYTES, cleanInput, renderMarkdown } from '$lib/server/markdown';
import { hashPassword } from '$lib/server/password';
import { checkRateLimit } from '$lib/server/rate-limit';

const SLUG_RE = /^[a-z0-9-]{3,32}$/;
const EXPIRY_ALLOWLIST = [3600, 86400, 604800, 2592000];

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = checkRateLimit(ip);
	if (!allowed) {
		return json({ error: 'Rate limit exceeded (20/hr)' }, { status: 429 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { title, markdown, slug, password, expiresInSec, maxViews } = body as {
		title?: unknown;
		markdown?: unknown;
		slug?: unknown;
		password?: unknown;
		expiresInSec?: unknown;
		maxViews?: unknown;
	};
	if (typeof title !== 'string' || typeof markdown !== 'string') {
		return json({ error: 'title and markdown must be strings' }, { status: 400 });
	}

	const cleanTitle = cleanInput(title).trim().slice(0, 200);
	const cleanMarkdown = cleanInput(markdown);
	if (!cleanTitle || !cleanMarkdown.trim()) {
		return json({ error: 'title and markdown must be non-empty' }, { status: 400 });
	}
	if (Buffer.byteLength(cleanMarkdown, 'utf8') > MAX_MARKDOWN_BYTES) {
		return json({ error: 'markdown exceeds 512KB' }, { status: 413 });
	}

	let slugVal: string | null = null;
	if (slug !== undefined) {
		if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
			return json({ error: 'slug must match ^[a-z0-9-]{3,32}$' }, { status: 400 });
		}
		// Slugs must not shadow an existing id either (resolution is slug-first).
		const clash = db
			.select({ id: documents.id })
			.from(documents)
			.where(or(eq(documents.slug, slug), eq(documents.id, slug)))
			.get();
		if (clash) return json({ error: 'slug taken' }, { status: 409 });
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
			return json({ error: 'expiresInSec must be one of 3600, 86400, 604800, 2592000' }, { status: 400 });
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

	const id = nanoid(8);
	const html = await renderMarkdown(cleanMarkdown);

	db.insert(documents)
		.values({
			id,
			title: cleanTitle,
			rawMarkdown: cleanMarkdown,
			html,
			createdAt: Date.now(),
			views: 0,
			slug: slugVal,
			passwordHash,
			expiresAt,
			maxViews: maxViewsVal
		})
		.run();

	return json({ id, slug: slugVal, url: slugVal ? `/s/${slugVal}` : `/s/${id}` }, { status: 201 });
};
