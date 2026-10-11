#!/usr/bin/env node
// One-time copy of every row from the local SQLite file into Turso.
// Usage: TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun scripts/migrate-to-turso.mjs
//   - Reads local.db (DATABASE_PATH / DATABASE_URL override, else ./local.db).
//   - Refuses to run without TURSO_DATABASE_URL (clear error, exit 1).
//   - Refuses when the remote `documents` table is missing (run db:migrate
//     against Turso first — see .env.example).
//   - Idempotent-ish: INSERT OR IGNORE skips ids that already exist.
//   - NEVER writes to local.db (opens it read-only via file: URL + SELECTs only).
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl) {
	console.error(
		'[migrate-to-turso] TURSO_DATABASE_URL is not set.\n' +
			'  1. turso db show sharemd --url   -> TURSO_DATABASE_URL\n' +
			'  2. turso db tokens create sharemd -> TURSO_AUTH_TOKEN\n' +
			'  3. TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun scripts/migrate-to-turso.mjs'
	);
	process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const candidates = [
	process.env.DATABASE_PATH ?? process.env.DATABASE_URL,
	resolve(scriptDir, '..', 'sharemd-prod-db', 'sharemd-prod.db'),
	resolve('local.db')
].filter(Boolean);
const localPath = candidates.find((p) => existsSync(p));
if (!localPath) {
	console.error(
		`[migrate-to-turso] local DB not found. Tried:\n${candidates.map((p) => `  - ${p}`).join('\n')}\n  (set DATABASE_PATH to override)`
	);
	process.exit(1);
}

const local = createClient({ url: `file:${localPath}` });
const remote = createClient({ url: tursoUrl, authToken: tursoToken });

// Remote must already be migrated — otherwise the copy target does not exist.
try {
	await remote.execute('SELECT id FROM documents LIMIT 1');
} catch {
	console.error(
		'[migrate-to-turso] remote `documents` table is missing.\n' +
			'  Run migrations against Turso first:\n' +
			'    TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun run db:migrate'
	);
	process.exit(1);
}

const COLS = [
	'id',
	'title',
	'raw_markdown',
	'html',
	'created_at',
	'views',
	'slug',
	'password_hash',
	'delete_token_hash',
	'expires_at',
	'max_views'
];

const { rows } = await local.execute(`SELECT ${COLS.join(', ')} FROM documents`);
let copied = 0;
let skipped = 0;

for (const r of rows) {
	const res = await remote.execute({
		sql: `INSERT OR IGNORE INTO documents (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`,
		args: COLS.map((c) => (r[c] === undefined ? null : r[c]))
	});
	if (res.rowsAffected > 0) copied++;
	else skipped++;
}

console.log(`[migrate-to-turso] total=${rows.length} copied=${copied} skipped=${skipped} (local.db untouched)`);
local.close();
remote.close();
