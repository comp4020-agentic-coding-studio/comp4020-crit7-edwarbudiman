import { and, asc, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { getCourse, getProgram } from "./catalogue";
import { db } from "./db";
import { type PlannedCourse, type Semester, enrolments, plannedCourses, semesters, student } from "./schema";

export type { PlannedCourse, Semester };
export type SemesterPlan = Semester & { courses: PlannedCourse[] };

const today = () => new Date().toISOString().slice(0, 10);

// The current semester is the latest one that has started, so the gap
// between semesters still belongs to the one just finished.
export function currentSemester(on = today()): Semester | undefined {
  return db
    .select()
    .from(semesters)
    .where(lte(semesters.startsOn, on))
    .orderBy(desc(semesters.startsOn))
    .limit(1)
    .get();
}

export function getSemester(id: string): Semester | undefined {
  return db.select().from(semesters).where(eq(semesters.id, id)).get();
}

export function coursesFor(semesterId: string): PlannedCourse[] {
  return db
    .select()
    .from(plannedCourses)
    .where(eq(plannedCourses.semesterId, semesterId))
    .orderBy(asc(plannedCourses.code))
    .all();
}

// When the student's first semester started: semesters before it aren't
// theirs (a new student has none).
function firstStart(): string {
  const first = db.select({ id: student.firstSemesterId }).from(student).get()?.id;
  return (first && getSemester(first)?.startsOn) || "";
}

// The student's semesters that started before the current one, latest first.
export function previousPlans(on = today()): SemesterPlan[] {
  const current = currentSemester(on);
  if (!current) return [];
  return db
    .select()
    .from(semesters)
    .where(and(sql`${semesters.startsOn} < ${current.startsOn}`, gte(semesters.startsOn, firstStart())))
    .orderBy(desc(semesters.startsOn))
    .all()
    .map((s) => ({ ...s, courses: coursesFor(s.id) }));
}

// The semester after this one, if the calendar has it.
export function nextSemester(id: string): Semester | undefined {
  const s = getSemester(id);
  if (!s) return undefined;
  return db.select().from(semesters).where(gt(semesters.startsOn, s.startsOn)).orderBy(asc(semesters.startsOn)).limit(1).get();
}

// Units the student has submitted, in their semesters up to and including
// this one.
function unitsThrough(s: Semester): number {
  return db
    .select({ code: plannedCourses.code })
    .from(plannedCourses)
    .innerJoin(enrolments, eq(enrolments.semesterId, plannedCourses.semesterId))
    .innerJoin(semesters, eq(semesters.id, plannedCourses.semesterId))
    .where(and(lte(semesters.startsOn, s.startsOn), gte(semesters.startsOn, firstStart())))
    .all()
    .reduce((n, r) => n + (getCourse(r.code)?.units ?? 6), 0);
}

// Semesters after the current one that the student has started planning (or
// the next one to plan, once the latest is submitted), earliest first. They
// stop once the program's units are all submitted: there's no semester after
// the last one.
export function upcomingPlans(on = today()): SemesterPlan[] {
  const current = currentSemester(on);
  if (!current) return [];
  const total = getProgram(db.select({ code: student.programCode }).from(student).get()?.code)?.minUnits ?? Infinity;
  const plans: SemesterPlan[] = [];
  let s = current;
  while (isSubmitted(s.id) && unitsThrough(s) < total) {
    const next = nextSemester(s.id);
    if (!next) break;
    plans.push({ ...next, courses: coursesFor(next.id) });
    s = next;
  }
  return plans;
}

// --- enrolment -------------------------------------------------------------
// A semester's picks are a draft until the student submits them.

export const isSubmitted = (semesterId: string) =>
  !!db.select().from(enrolments).where(eq(enrolments.semesterId, semesterId)).get();

export function submitSemester(semesterId: string): void {
  db.insert(enrolments).values({ semesterId }).onConflictDoNothing().run();
}

// Back to a draft, to change the picks.
export function reopenSemester(semesterId: string): void {
  db.delete(enrolments).where(eq(enrolments.semesterId, semesterId)).run();
}

export function addPlannedCourse(semesterId: string, code: string, title: string): void {
  db.insert(plannedCourses).values({ semesterId, code, title }).onConflictDoNothing().run();
}

export function removePlannedCourse(semesterId: string, id: number): void {
  db.delete(plannedCourses)
    .where(and(eq(plannedCourses.semesterId, semesterId), eq(plannedCourses.id, id)))
    .run();
}

const dateFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" });
export const formatRange = (s: Semester) =>
  `${dateFmt.format(new Date(s.startsOn))} – ${dateFmt.format(new Date(s.endsOn))}`;

export function getPlannedCourse(id: number): (PlannedCourse & { semester: Semester }) | undefined {
  const course = db.select().from(plannedCourses).where(eq(plannedCourses.id, id)).get();
  const semester = course && getSemester(course.semesterId);
  return course && semester ? { ...course, semester } : undefined;
}
