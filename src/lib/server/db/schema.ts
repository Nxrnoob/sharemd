import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
 * the rolling 1-hour window is anchored at the first hit in the window. */
export const rateHits = sqliteTable('rate_hits', {
	ip: text('ip').primaryKey(),
	windowStart: integer('window_start').notNull(),
	count: integer('count').notNull().default(1)
});

export type RateHit = typeof rateHits.$inferSelect;
