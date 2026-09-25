CREATE TABLE `planned_courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`semester_id` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semesters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planned_courses_semester_code` ON `planned_courses` (`semester_id`,`code`);--> statement-breakpoint
CREATE TABLE `semesters` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL
);
