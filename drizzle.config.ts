import { defineConfig } from 'drizzle-kit';

// Vercel + Turso: when TURSO_DATABASE_URL is set, drizzle-kit talks to the
// remote (driver turso) — `bun run db:migrate` then migrates Turso.
// Otherwise it uses the local file (`bun run db:migrate` migrates local.db,
// offline, zero config). DATABASE_PATH / DATABASE_URL overrides honored.
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
const localPath = process.env.DATABASE_PATH ?? process.env.DATABASE_URL ?? 'local.db';
const localUrl = localPath.startsWith('file:') ? localPath : `file:${localPath}`;

export default tursoUrl
	? defineConfig({
			schema: './src/lib/server/db/schema.ts',
			out: './drizzle',
			dialect: 'turso',
			dbCredentials: { url: tursoUrl, authToken: tursoToken },
			verbose: true,
			strict: true
		})
	: defineConfig({
			schema: './src/lib/server/db/schema.ts',
			out: './drizzle',
			dialect: 'sqlite',
			dbCredentials: { url: localUrl },
			verbose: true,
			strict: true
		});
