import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { gateDoc, resolveDoc, takeView } from '$lib/server/docs';

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
