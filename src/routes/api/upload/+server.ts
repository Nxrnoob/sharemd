import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkRateLimit } from '$lib/server/rate-limit';
import { MAX_IMAGE_BYTES, saveUpload } from '$lib/server/uploads';

const ALLOWED_TYPES: Record<string, true> = {
	'image/png': true,
	'image/jpeg': true,
	'image/webp': true,
	'image/gif': true,
	'image/svg+xml': true
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = checkRateLimit(ip);
	if (!allowed) {
		return json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 });
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ error: 'Invalid form data' }, { status: 400 });
	}

	const file = formData.get('file');
	if (!(file instanceof File)) {
		return json({ error: 'Missing image file' }, { status: 400 });
	}

	if (!ALLOWED_TYPES[file.type.toLowerCase()]) {
		return json(
			{ error: 'Only PNG, JPEG, WebP, GIF, and SVG images are supported.' },
			{ status: 400 }
		);
	}

	if (file.size > MAX_IMAGE_BYTES) {
		return json({ error: 'Image exceeds 5MB size limit.' }, { status: 413 });
	}

	try {
		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		const { filename, url } = saveUpload(buffer, file.type);

		return json({ filename, url }, { status: 201 });
	} catch (err) {
		return json({ error: 'Failed to save image' }, { status: 500 });
	}
};
