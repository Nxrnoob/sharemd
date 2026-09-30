import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { documents } from '$lib/server/db/schema';

export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;
	if (!id) return new Response('Missing id', { status: 400 });

	const row = db.select().from(documents).where(eq(documents.id, id)).get();
	if (!row) return new Response('Not found', { status: 404 });

	return new Response(row.rawMarkdown, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-disposition': `attachment; filename="${id}.md"`
		}
	});
};
