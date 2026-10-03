import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteDoc, gateDoc, resolveDoc, takeView, verifyDeleteToken } from '$lib/server/docs';
import { checkRateLimit } from '$lib/server/rate-limit';

export const GET: RequestHandler = async ({ params, url }) => {
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
	if (!takeView(row.id)) return json({ gone: true }, { status: 410 });

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
