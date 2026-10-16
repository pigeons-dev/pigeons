CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subject` text,
	`template_id` text,
	`template_data` text,
	`from_name` text,
	`from_email` text,
	`audience_filter` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`scheduled_at` text,
	`started_at` text,
	`completed_at` text,
	`stats` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sequence_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`current_step_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`enrolled_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sequence_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`template_id` text,
	`template_data` text,
	`subject` text,
	`delay_duration` text,
	`condition` text,
	`stats` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`trigger` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`stats` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
