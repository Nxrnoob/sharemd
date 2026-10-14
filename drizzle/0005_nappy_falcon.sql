CREATE TABLE `bundle_items` (
	`bundle_id` text NOT NULL,
	`doc_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`bundle_id`, `doc_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_bundle_items_bundle` ON `bundle_items` (`bundle_id`);--> statement-breakpoint
CREATE TABLE `bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text,
	`created_at` integer NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`password_hash` text,
	`delete_token_hash` text,
	`expires_at` integer,
	`max_views` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bundles_slug_unique` ON `bundles` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_bundles_expires_at` ON `bundles` (`expires_at`);