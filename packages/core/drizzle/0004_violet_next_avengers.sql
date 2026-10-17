CREATE TABLE `subscription_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_topics_name_unique` ON `subscription_topics` (`name`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `topic_id` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `unsubscribed_topics` text;--> statement-breakpoint
ALTER TABLE `sequence_steps` ADD `topic_id` text;