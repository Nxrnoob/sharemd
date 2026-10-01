ALTER TABLE `documents` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `max_views` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_slug_unique` ON `documents` (`slug`);