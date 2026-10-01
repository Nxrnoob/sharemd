import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const documents = sqliteTable('documents', {
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	rawMarkdown: text('raw_markdown').notNull(),
	html: text('html').notNull(),
	createdAt: integer('created_at').notNull(),
	views: integer('views').notNull().default(0),
	slug: text('slug').unique(),
	passwordHash: text('password_hash'),
	expiresAt: integer('expires_at'),
	maxViews: integer('max_views')
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
