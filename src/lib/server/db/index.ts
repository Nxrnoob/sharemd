import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

// Vercel + Turso: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) wins when set.
// Local dev stays offline with zero config: DATABASE_PATH / DATABASE_URL
// override, else ./local.db. `dbPath` is still the local file path
// (uploads.ts stores images next to it).
export const dbPath = env.DATABASE_PATH ?? env.DATABASE_URL ?? 'local.db';

const tursoUrl = env.TURSO_DATABASE_URL;
const tursoToken = env.TURSO_AUTH_TOKEN;

function toFileUrl(p: string): string {
	const stripped = p.replace(/^file:/, '');
	if (!tursoUrl) mkdirSync(dirname(stripped), { recursive: true });
	return `file:${stripped}`;
}

const client = tursoUrl
	? createClient({ url: tursoUrl, authToken: tursoToken })
	: createClient({ url: toFileUrl(dbPath) });

export const db = drizzle(client, { schema });
