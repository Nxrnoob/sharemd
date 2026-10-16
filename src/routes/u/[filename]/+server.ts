import type { RequestHandler } from './$types';
import { getUpload } from '$lib/server/uploads';

export const GET: RequestHandler = async ({ params }) => {
	const { filename } = params;
	if (!filename) return new Response('Not found', { status: 404 });

	const item = await getUpload(filename);
	if (!item) return new Response('Not found', { status: 404 });

	const isSvg = item.contentType.includes('svg') || filename.toLowerCase().endsWith('.svg');
	return new Response(new Uint8Array(item.buffer), {
		headers: {
			'content-type': item.contentType,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox",
			'content-disposition': isSvg ? `attachment; filename="${filename}"` : 'inline'
		}
	});
};
