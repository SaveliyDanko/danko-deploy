CREATE TABLE `ssh_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`public_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`private_key_enc` text NOT NULL,
	`passphrase_enc` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`auth_method` text NOT NULL,
	`secret_enc` text,
	`key_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`key_id`) REFERENCES `ssh_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_servers`("id", "name", "host", "port", "username", "auth_method", "secret_enc", "created_at", "updated_at") SELECT "id", "name", "host", "port", "username", "auth_method", "secret_enc", "created_at", "updated_at" FROM `servers`;--> statement-breakpoint
DROP TABLE `servers`;--> statement-breakpoint
ALTER TABLE `__new_servers` RENAME TO `servers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;