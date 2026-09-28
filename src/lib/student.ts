import { eq } from "drizzle-orm";
import { getCourse, getProgram } from "./catalogue";
import { db } from "./db";
import { DEMO_HISTORY } from "./demo";
import { currentSemester } from "./plans";
import { type Student, enrolments, plannedCourses, student } from "./schema";

export type { Student };

// There is one student — the planner's "account" — so it's always row 1.
const ID = 1;

const HISTORY_START = Object.keys(DEMO_HISTORY)[0]!;

// The demo history's semesters, each submitted.
function seedHistory(tx: Pick<typeof db, "insert">) {
  for (const [semesterId, codes] of Object.entries(DEMO_HISTORY)) {
    for (const code of codes) {
      const course = getCourse(code);
      if (!course) throw new Error(`demo course ${code} is not in the catalogue`);
      tx.insert(plannedCourses).values({ semesterId, code, title: course.title }).onConflictDoNothing().run();
    }
    tx.insert(enrolments).values({ semesterId }).onConflictDoNothing().run();
  }
}

// The account exists from the first visit, with the demo history, and no
// program until the student chooses one.
export function getStudent(): Student {
  const row = db.select().from(student).where(eq(student.id, ID)).get();
  if (row) return row;
  return db.transaction((tx) => {
    seedHistory(tx);
    tx.insert(student).values({ id: ID, firstSemesterId: HISTORY_START }).onConflictDoNothing().run();
    return tx.select().from(student).where(eq(student.id, ID)).get()!;
  });
}

// The student's program — the one choice the planner needs. Majors and
// specialisations aren't chosen here: the Majors tab shows progress toward
// all of them.
export function setProgram(programCode: string): boolean {
  const program = getProgram(programCode);
  if (!program) return false;
  getStudent();
  db.update(student).set({ programCode: program.code, updatedAt: new Date().toISOString() }).where(eq(student.id, ID)).run();
  return true;
}

// Start the demo over with no program chosen: as a new student whose first
// semester is the current one ("fresh"), or with the demo history of three
// earlier semesters.
export function resetDemo(start: "fresh" | "history"): void {
  getStudent();
  const firstSemesterId = start === "fresh" ? (currentSemester()?.id ?? HISTORY_START) : HISTORY_START;
  db.transaction((tx) => {
    tx.delete(plannedCourses).run();
    tx.delete(enrolments).run();
    if (start === "history") seedHistory(tx);
    tx.update(student)
      .set({ programCode: null, firstSemesterId, updatedAt: new Date().toISOString() })
      .where(eq(student.id, ID))
      .run();
  });
}
