import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const documents = sqliteTable(
	'documents',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		rawMarkdown: text('raw_markdown').notNull(),
		html: text('html').notNull(),
		createdAt: integer('created_at').notNull(),
		views: integer('views').notNull().default(0),
		slug: text('slug').unique(),
		passwordHash: text('password_hash'),
		deleteTokenHash: text('delete_token_hash'),
		expiresAt: integer('expires_at'),
		maxViews: integer('max_views')
	},
	(table) => [
		index('idx_documents_created_at').on(table.createdAt),
		index('idx_documents_expires_at').on(table.expiresAt)
	]
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

/** Turso-backed rate-limit buckets (serverless-safe). One row per IP:
 *  the rolling 1-hour window is anchored at the first hit in the window. */
export const rateHits = sqliteTable('rate_hits', {
	ip: text('ip').primaryKey(),
	windowStart: integer('window_start').notNull(),
	count: integer('count').notNull().default(1)
});

export type RateHit = typeof rateHits.$inferSelect;

/**
 * A bundle: one share link that covers several docs.
 *
 * Deliberately the same shape as `documents` — same gates, same capability
 * token, same lazy expiry, same atomic view-take — so a bundle reuses every
 * hardened path that already exists. No accounts: a bundle owns nothing but its
 * own membership list.
 *
 * `theme` is the creator's colourway for the folder page. It is a presentation
 * choice, not a gate — a recipient can still override it for their own session
 * with `?theme=`, exactly as on a doc.
 */
export const bundles = sqliteTable(
	'bundles',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		slug: text('slug').unique(),
		createdAt: integer('created_at').notNull(),
		views: integer('views').notNull().default(0),
		passwordHash: text('password_hash'),
		deleteTokenHash: text('delete_token_hash'),
		expiresAt: integer('expires_at'),
		maxViews: integer('max_views'),
		theme: text('theme')
	},
	(table) => [index('idx_bundles_expires_at').on(table.expiresAt)]
);

export type Bundle = typeof bundles.$inferSelect;
export type NewBundle = typeof bundles.$inferInsert;

/**
 * Membership. `docId` is a plain column with no foreign key: deleting a doc
 * removes its rows in application code, which keeps bundle cleanup working
 * identically whether or not the SQLite connection has `foreign_keys` enabled
 * (it is off by default, and Turso does not assume otherwise).
 *
 * `position` freezes the creator's folder order. A bundle is an immutable
 * snapshot, so nothing ever re-sorts this.
 *
 * `contributorName` is null for docs the creator added at share time, and holds
 * the display name for docs added later by someone holding the folder password.
 * That null-vs-set distinction is the only record of provenance, and it is what
 * marks a doc as a contribution — the contributor owns it outright via its own
 * delete token, so it is never editable by the bundle creator or by other
 * contributors.
 */
export const bundleItems = sqliteTable(
	'bundle_items',
	{
		bundleId: text('bundle_id').notNull(),
		docId: text('doc_id').notNull(),
		position: integer('position').notNull(),
		contributorName: text('contributor_name')
	},
	(table) => [
		primaryKey({ columns: [table.bundleId, table.docId] }),
		index('idx_bundle_items_bundle').on(table.bundleId)
	]
);


/**
 * Uploaded image assets. Stored in the database so images survive
 * serverless function lifecycles and read-only container runtimes (such as Vercel).
 */
export const uploads = sqliteTable('uploads', {
	filename: text('filename').primaryKey(),
	contentType: text('content_type').notNull(),
	dataBase64: text('data_base64').notNull(),
	createdAt: integer('created_at').notNull()
});

export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
export type BundleItem = typeof bundleItems.$inferSelect;
