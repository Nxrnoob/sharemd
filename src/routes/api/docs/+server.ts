import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import { db } from '$lib/server/db';
import { documents } from '$lib/server/db/schema';
import { MAX_MARKDOWN_BYTES, cleanInput, renderMarkdown } from '$lib/server/markdown';
import { checkRateLimit } from '$lib/server/rate-limit';

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

	const { title, markdown } = body as { title?: unknown; markdown?: unknown };
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

	const id = nanoid(8);
	const html = await renderMarkdown(cleanMarkdown);

	db.insert(documents)
		.values({
			id,
			title: cleanTitle,
			rawMarkdown: cleanMarkdown,
			html,
			createdAt: Date.now(),
			views: 0
		})
		.run();

	return json({ id, url: `/s/${id}` }, { status: 201 });
};
