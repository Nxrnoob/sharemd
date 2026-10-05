import type { RequestHandler } from './$types';
import { getUpload } from '$lib/server/uploads';

export const GET: RequestHandler = async ({ params }) => {
	const { filename } = params;
	if (!filename) return new Response('Not found', { status: 404 });

	const item = getUpload(filename);
	if (!item) return new Response('Not found', { status: 404 });

	return new Response(new Uint8Array(item.buffer), {
		headers: {
			'content-type': item.contentType,
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
};
