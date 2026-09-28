CREATE TABLE `courses` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`units` real NOT NULL,
	`level` text NOT NULL,
	`subject` text NOT NULL,
	`school` text NOT NULL,
	`url` text NOT NULL,
	`requisite_text` text NOT NULL,
	`requires` text,
	`notes` text NOT NULL,
	`incompatible_with` text NOT NULL,
	`transdisciplinary` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enrolments` (
	`semester_id` text PRIMARY KEY NOT NULL,
	`submitted_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`semester_id`) REFERENCES `semesters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prerequisites` (
	`course_code` text NOT NULL,
	`requires_code` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`course_code`, `requires_code`),
	FOREIGN KEY (`course_code`) REFERENCES `courses`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `student` ADD `first_semester_id` text REFERENCES semesters(id);