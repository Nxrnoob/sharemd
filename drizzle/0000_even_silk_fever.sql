CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`raw_markdown` text NOT NULL,
	`html` text NOT NULL,
	`created_at` integer NOT NULL,
	`views` integer DEFAULT 0 NOT NULL
);
