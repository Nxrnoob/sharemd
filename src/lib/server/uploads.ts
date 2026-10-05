import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { nanoid } from 'nanoid';
import { dbPath } from '$lib/server/db';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'image/gif': '.gif',
	'image/svg+xml': '.svg'
};

const MIME_BY_EXT: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml'
};

export function getUploadDir(): string {
	const dir = join(dirname(dbPath), 'uploads');
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function saveUpload(
	buffer: Buffer,
	mimeType: string
): { filename: string; url: string } {
	const ext = ALLOWED_MIME_TYPES[mimeType.toLowerCase()] ?? '.png';
	const id = nanoid(12);
	const filename = `${id}${ext}`;
	const uploadDir = getUploadDir();
	const fullPath = join(uploadDir, filename);

	writeFileSync(fullPath, buffer);

	return {
		filename,
		url: `/u/${filename}`
	};
}

export function getUpload(filename: string): { buffer: Buffer; contentType: string } | null {
	// Sanitize filename to prevent directory traversal
	const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '');
	if (!sanitized || sanitized !== filename) return null;

	const fullPath = join(getUploadDir(), sanitized);
	if (!existsSync(fullPath)) return null;

	const ext = extname(sanitized).toLowerCase();
	const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
	const buffer = readFileSync(fullPath);

	return { buffer, contentType };
}
