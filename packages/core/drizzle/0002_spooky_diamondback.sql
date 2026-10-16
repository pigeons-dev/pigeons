CREATE TABLE `inbox_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`direction` text NOT NULL,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`cc` text,
	`subject` text,
	`html` text,
	`text` text,
	`extracted_html` text,
	`extracted_text` text,
	`thread_id` text,
	`message_id` text,
	`in_reply_to` text,
	`references` text,
	`ses_message_id` text,
	`attachments` text,
	`raw_mime_path` text,
	`labels` text,
	`headers` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email_address` text NOT NULL,
	`description` text,
	`webhook_url` text,
	`metadata` text,
	`auto_reply_enabled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`labels` text,
	`catch_all` integer DEFAULT false NOT NULL,
	`api_key_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inboxes_email_address_unique` ON `inboxes` (`email_address`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`subject` text,
	`last_message_at` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`participants` text,
	`status` text DEFAULT 'open' NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`response_status` integer,
	`response_body` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`events` text NOT NULL,
	`secret` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_triggered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
