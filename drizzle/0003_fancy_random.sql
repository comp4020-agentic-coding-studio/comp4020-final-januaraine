CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`creator_player_id` integer NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`allow_viewers` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`creator_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_name_key_unique` ON `rooms` (`name_key`);