import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { documents } from '$lib/server/db/schema';

export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	const row = db.select().from(documents).where(eq(documents.id, id)).get();
	if (!row) return json({ error: 'Not found' }, { status: 404 });

	return json({
		id: row.id,
		title: row.title,
		markdown: row.rawMarkdown,
		html: row.html,
		createdAt: row.createdAt,
		views: row.views
	});
};
