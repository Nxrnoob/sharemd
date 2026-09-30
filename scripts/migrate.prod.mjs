// Production boot migration (no drizzle-kit needed).
// Applies ./drizzle/*.sql to DATABASE_PATH before the server starts.
// Local dev is unaffected: keep using `bun run db:migrate` (drizzle-kit).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dbPath = process.env.DATABASE_PATH ?? process.env.DATABASE_URL ?? '/data/local.db';
mkdirSync(dirname(resolve(dbPath)), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

migrate(drizzle(sqlite), {
	migrationsFolder: resolve(import.meta.dirname ?? '.', '../drizzle')
});

console.log(`[migrate] applied drizzle migrations to ${dbPath}`);
sqlite.close();
