CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`scopes` text,
	`expires_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`dkim_tokens` text,
	`spf_verified` integer DEFAULT false NOT NULL,
	`dmarc_verified` integer DEFAULT false NOT NULL,
	`region` text NOT NULL,
	`capabilities` text NOT NULL,
	`records` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_domain_unique` ON `domains` (`domain`);--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`cc` text,
	`bcc` text,
	`subject` text NOT NULL,
	`html` text,
	`text` text,
	`template_id` text,
	`template_data` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`ses_message_id` text,
	`inbox_id` text,
	`thread_id` text,
	`headers` text,
	`tags` text,
	`idempotency_key` text,
	`scheduled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`response` text NOT NULL,
	`status_code` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
