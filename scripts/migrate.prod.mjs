// Production boot migration (no drizzle-kit needed).
// Applies ./drizzle/*.sql to the configured DB before the server starts.
// Works with a local file (DATABASE_PATH) or Turso (TURSO_DATABASE_URL +
// TURSO_AUTH_TOKEN). Local dev is unaffected: keep using `bun run db:migrate`.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
const dbPath = process.env.DATABASE_PATH ?? process.env.DATABASE_URL ?? '/data/local.db';

const client = tursoUrl
	? createClient({ url: tursoUrl, authToken: tursoToken })
	: createClient({ url: `file:${dbPath.replace(/^file:/, '')}` });

if (!tursoUrl) mkdirSync(dirname(resolve(dbPath.replace(/^file:/, ''))), { recursive: true });

await migrate(drizzle(client), {
	migrationsFolder: resolve(import.meta.dirname ?? '.', '../drizzle')
});

console.log(`[migrate] applied drizzle migrations to ${tursoUrl ? tursoUrl : dbPath}`);
client.close();
