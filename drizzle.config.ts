import { defineConfig } from 'drizzle-kit';

// Docker/Dokploy: DATABASE_PATH (default /data/local.db) wins;
// local dev keeps using DATABASE_URL from .env (`bun run db:migrate`).
const dbPath = process.env.DATABASE_PATH ?? process.env.DATABASE_URL ?? '/data/local.db';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: dbPath },
	verbose: true,
	strict: true
});
