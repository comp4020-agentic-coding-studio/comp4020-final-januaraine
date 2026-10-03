CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`score` integer NOT NULL,
	`ticks` integer NOT NULL,
	`survival_time_ms` integer NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text DEFAULT (datetime('now')) NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_token` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_session_token_unique` ON `players` (`session_token`);