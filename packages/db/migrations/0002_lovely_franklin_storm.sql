CREATE TABLE `metrics_snapshots` (
	`server_id` text PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
