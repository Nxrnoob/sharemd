import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

// Docker/Dokploy: DATABASE_PATH (default /data/local.db) wins;
// local dev keeps using DATABASE_URL from .env.
export const dbPath = env.DATABASE_PATH ?? env.DATABASE_URL ?? '/data/local.db';

mkdirSync(dirname(dbPath), { recursive: true });

const client = new Database(dbPath);
client.pragma('journal_mode = WAL');
client.pragma('busy_timeout = 5000');
client.pragma('synchronous = NORMAL');

export const db = drizzle(client, { schema });
