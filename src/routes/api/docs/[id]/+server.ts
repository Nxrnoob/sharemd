import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteDoc, gateDoc, isCrawlerBot, resolveDoc, takeView, updateDoc, verifyDeleteToken } from '$lib/server/docs';
import { checkRateLimit } from '$lib/server/rate-limit';
import { cleanInput, renderMarkdown, MAX_MARKDOWN_BYTES } from '$lib/server/markdown';

export const GET: RequestHandler = async ({ params, url, request }) => {
	const { id } = params;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	const row = resolveDoc(id);
	if (!row) return json({ error: 'Not found' }, { status: 404 });

	const gate = gateDoc(row, url.searchParams.get('pw'));
	if (!gate.ok) {
		if (gate.status === 'gone') return json({ gone: true }, { status: 410 });
		return json({ passwordRequired: true }, { status: 403 });
	}

	// Views increment only on successful serve; the guard makes it atomic.
	// Crawler bots generating link cards do not consume views.
	const isBot = isCrawlerBot(request.headers.get('user-agent'));
	if (!isBot && !takeView(row.id)) return json({ gone: true }, { status: 410 });

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
	const { allowed } = checkRateLimit(ip);
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
	const row = resolveDoc(id);
	if (!row || !row.deleteTokenHash) return json({ error: 'Not found' }, { status: 404 });

	if (typeof token !== 'string' || !token || !verifyDeleteToken(row, token)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	deleteDoc(row.id);
	return json({ deleted: true });
};

export const PUT: RequestHandler = async ({ params, request, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = checkRateLimit(ip);
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

	const { title, markdown, token } = (body && typeof body === 'object' ? body : {}) as {
		title?: unknown;
		markdown?: unknown;
		token?: unknown;
	};

	if (typeof markdown !== 'string' || !markdown.trim()) {
		return json({ error: 'Markdown must be non-empty' }, { status: 400 });
	}
	if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
		return json({ error: 'Markdown exceeds 512KB' }, { status: 413 });
	}

	const row = resolveDoc(id);
	if (!row || !row.deleteTokenHash) return json({ error: 'Not found' }, { status: 404 });

	if (typeof token !== 'string' || !token || !verifyDeleteToken(row, token)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const cleanTitle = (typeof title === 'string' && title.trim() ? title : row.title).trim().slice(0, 200);
	const cleanMd = cleanInput(markdown);
	const html = await renderMarkdown(cleanMd);

	updateDoc(row.id, cleanTitle, cleanMd, html);

	return json({
		ok: true,
		id: row.id,
		slug: row.slug,
		title: cleanTitle
	});
};
