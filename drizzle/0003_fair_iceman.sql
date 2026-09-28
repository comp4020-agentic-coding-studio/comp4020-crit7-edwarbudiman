CREATE TABLE `student` (
	`id` integer PRIMARY KEY NOT NULL,
	`program_code` text,
	`stream_code` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
