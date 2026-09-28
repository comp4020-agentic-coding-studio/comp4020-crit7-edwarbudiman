import { sql } from "drizzle-orm";
import { int, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Req } from "./requisites";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.
export const messages = sqliteTable("messages", {
  id: int().primaryKey({ autoIncrement: true }),
  body: text().notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Message = typeof messages.$inferSelect;

// A teaching period. Rows are reference data seeded by migration (dates from
// the ANU university calendar); the app never writes them.
export const semesters = sqliteTable("semesters", {
  id: text().primaryKey(), // e.g. "2026-S2"
  label: text().notNull(), // e.g. "Second Semester, 2026"
  startsOn: text("starts_on").notNull(), // ISO date, first teaching day
  endsOn: text("ends_on").notNull(), // ISO date, last exam day
});

// One course a student has put in their plan for a semester.
export const plannedCourses = sqliteTable(
  "planned_courses",
  {
    id: int().primaryKey({ autoIncrement: true }),
    semesterId: text("semester_id")
      .notNull()
      .references(() => semesters.id),
    code: text().notNull(),
    title: text().notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("planned_courses_semester_code").on(t.semesterId, t.code)],
);

export type Semester = typeof semesters.$inferSelect;
export type PlannedCourse = typeof plannedCourses.$inferSelect;

// The one student this planner serves (id 1) — the "account". The program
// code is from src/lib/data/; null until the student picks one.
export const student = sqliteTable("student", {
  id: int().primaryKey(),
  programCode: text("program_code"),
  // the student's first semester; earlier ones aren't theirs
  firstSemesterId: text("first_semester_id").references(() => semesters.id),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Student = typeof student.$inferSelect;

// A semester whose selection the student has submitted. Until then its
// planned courses are a draft; once submitted they count as done for every
// later semester's plan.
export const enrolments = sqliteTable("enrolments", {
  semesterId: text("semester_id")
    .primaryKey()
    .references(() => semesters.id),
  submittedAt: text("submitted_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// The course catalogue: reference data loaded at boot from src/lib/data/
// (ANU Programs and Courses) by src/lib/catalogue.ts — the app never edits
// it otherwise. `requires` is the parsed AND/OR prerequisite tree.
export const courses = sqliteTable("courses", {
  code: text().primaryKey(),
  title: text().notNull(),
  units: real().notNull(),
  level: text({ enum: ["undergraduate", "postgraduate"] }).notNull(),
  subject: text().notNull(),
  school: text().notNull(),
  url: text().notNull(),
  requisiteText: text("requisite_text").notNull(),
  requires: text({ mode: "json" }).$type<Req | null>(),
  notes: text({ mode: "json" }).$type<string[]>().notNull(),
  incompatibleWith: text("incompatible_with", { mode: "json" }).$type<string[]>().notNull(),
  transdisciplinary: int({ mode: "boolean" }).notNull(),
});

// Every course a course's prerequisites name, and whether it's needed on
// every path ("required") or one of several ("alternative") — the tree's
// lines.
export const prerequisites = sqliteTable(
  "prerequisites",
  {
    courseCode: text("course_code")
      .notNull()
      .references(() => courses.code),
    requiresCode: text("requires_code").notNull(),
    kind: text({ enum: ["required", "alternative"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.courseCode, t.requiresCode] })],
);

export type CourseRow = typeof courses.$inferSelect;
