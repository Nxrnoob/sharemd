import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { documents } from '$lib/server/db/schema';

// Placeholder for @designer: loads pre-rendered HTML (no re-parse here).
// renderMarkdown() runs only at POST time in src/lib/server/markdown.ts.
export const load: PageServerLoad = async ({ params }) => {
	const row = db.select().from(documents).where(eq(documents.id, params.id)).get();
	if (!row) throw error(404, 'Not found');

	db.update(documents)
		.set({ views: sql`${documents.views} + 1` })
		.where(eq(documents.id, params.id))
		.run();

	// Reading time from stored raw markdown (no re-parse of HTML needed).
	const words = row.rawMarkdown.trim().split(/\s+/).filter(Boolean).length;
	const readMins = Math.max(1, Math.ceil(words / 200));

	return {
		id: row.id,
		title: row.title,
		html: row.html,
		createdAt: row.createdAt,
		views: (row.views ?? 0) + 1,
		readTime: `${readMins} min read`
	};
};
