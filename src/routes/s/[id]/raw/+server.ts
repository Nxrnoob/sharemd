import type { RequestHandler } from './$types';
import { gateDoc, resolveDoc } from '$lib/server/docs';

export const GET: RequestHandler = async ({ params, url }) => {
	const { id } = params;
	if (!id) return new Response('Missing id', { status: 400 });

	const row = resolveDoc(id);
	if (!row) return new Response('Not found', { status: 404 });

	const gate = gateDoc(row, url.searchParams.get('pw'));
	if (!gate.ok) {
		if (gate.status === 'gone') return new Response('Gone', { status: 410 });
		return new Response('Password required', { status: 403 });
	}

	return new Response(row.rawMarkdown, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-disposition': `attachment; filename="${row.id}.md"`
		}
	});
};
