CREATE TABLE `uploads` (
	`filename` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`data_base64` text NOT NULL,
	`created_at` integer NOT NULL
);
