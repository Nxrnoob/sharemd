import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import { db, dbPath } from '$lib/server/db';
import { uploads } from '$lib/server/db/schema';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'image/gif': '.gif'
};

const MIME_BY_EXT: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export function getUploadDir(): string {
	const dir = join(dirname(dbPath), 'uploads');
	try {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	} catch {
		// Read-only filesystem on Vercel serverless
	}
	return dir;
}

let tableChecked = false;
async function ensureUploadsTable(): Promise<void> {
	if (tableChecked) return;
	try {
		await db.run(sql`CREATE TABLE IF NOT EXISTS uploads (
			filename TEXT PRIMARY KEY,
			content_type TEXT NOT NULL,
			data_base64 TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`);
		tableChecked = true;
	} catch {
		// Table already exists or handled by migration
	}
}

export async function saveUpload(
	buffer: Buffer,
	mimeType: string
): Promise<{ filename: string; url: string }> {
	const ext = ALLOWED_MIME_TYPES[mimeType.toLowerCase()] ?? '.png';
	const id = nanoid(12);
	const filename = `${id}${ext}`;
	const contentType = MIME_BY_EXT[ext] ?? mimeType;

	await ensureUploadsTable();

	// 1. Persist to database (works in serverless and containers)
	await db
		.insert(uploads)
		.values({
			filename,
			contentType,
			dataBase64: buffer.toString('base64'),
			createdAt: Date.now()
		})
		.run();

	// 2. Best-effort local file cache (silently ignored on read-only environments)
	try {
		const uploadDir = getUploadDir();
		const fullPath = join(uploadDir, filename);
		writeFileSync(fullPath, buffer);
	} catch {
		// Ignore EROFS on read-only filesystem
	}

	return {
		filename,
		url: `/u/${filename}`
	};
}

export async function getUpload(
	filename: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
	// Sanitize filename to prevent directory traversal
	const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '');
	if (!sanitized || sanitized !== filename) return null;

	// 1. Try local file cache first for fast disk reads if available
	try {
		const fullPath = join(getUploadDir(), sanitized);
		if (existsSync(fullPath)) {
			const ext = extname(sanitized).toLowerCase();
			const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
			const buffer = readFileSync(fullPath);
			return { buffer, contentType };
		}
	} catch {
		// Disk unavailable or absent, fall back to DB
	}

	// 2. Query database
	await ensureUploadsTable();
	try {
		const row = await db.select().from(uploads).where(eq(uploads.filename, sanitized)).get();
		if (row) {
			return {
				buffer: Buffer.from(row.dataBase64, 'base64'),
				contentType: row.contentType
			};
		}
	} catch {
		// Query failed
	}

	return null;
}
