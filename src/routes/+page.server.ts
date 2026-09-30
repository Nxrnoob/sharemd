import type { PageServerLoad } from './$types';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { documents } from '$lib/server/db/schema';

// Placeholder for @designer: loads recent docs for the landing page.
export const load: PageServerLoad = async () => {
	const recent = db
		.select({
			id: documents.id,
			title: documents.title,
			createdAt: documents.createdAt,
			views: documents.views
		})
		.from(documents)
		.orderBy(desc(documents.createdAt))
		.limit(10)
		.all();
	return { recent };
};
