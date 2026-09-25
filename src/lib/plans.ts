import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { type PlannedCourse, type Semester, plannedCourses, semesters } from "./schema";

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

// Every semester that has started before the current one, latest first.
export function previousPlans(on = today()): SemesterPlan[] {
  const current = currentSemester(on);
  if (!current) return [];
  return db
    .select()
    .from(semesters)
    .where(sql`${semesters.startsOn} < ${current.startsOn}`)
    .orderBy(desc(semesters.startsOn))
    .all()
    .map((s) => ({ ...s, courses: coursesFor(s.id) }));
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
