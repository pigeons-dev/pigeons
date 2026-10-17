ALTER TABLE `emails` ADD `track_opens` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `emails` ADD `open_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `emails` ADD `first_opened_at` text;--> statement-breakpoint
ALTER TABLE `emails` ADD `last_opened_at` text;