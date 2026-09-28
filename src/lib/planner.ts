// The skill tree's model: for one semester's plan, what state every course is
// in, which requirements it serves, and the student's progress. Pages render
// it; /api/plan asks it before adding.
//
// A tile's state, as the student reads it:
//   done       in an earlier semester the student submitted
//   taking     selected (or, once submitted, enrolled) for this semester
//   later      picked for a later semester
//   open       prerequisites met — can be selected now
//   next       not yet, but this semester's picks unlock it for next semester
//   locked     prerequisites not met
//   excluded   incompatible with something taken or picked
// Every course is treated as running every semester: the planner is about
// prerequisites, not timetables.
// and, separately, whether it's *needed*: it's on a program rule — or, in
// the Majors tab, a rule of the major being looked at — that isn't filled
// yet. "Needed · open" is what to take.
import { asc } from "drizzle-orm";
import { type Course, PREREQUISITES, type Program, type Stream, STREAMS, coursesAt, getCourse, getProgram } from "./catalogue";
import { db } from "./db";
import { type PlannedCourse, type Semester, getSemester, isSubmitted, nextSemester } from "./plans";
import { type CountedCourse, type RuleProgress, progress } from "./requirements";
import { type RequisiteContext, meets } from "./requisites";
import { enrolments, plannedCourses, semesters } from "./schema";
import { type Student, getStudent } from "./student";

// ANU's standard full-time load is 24 units a semester; more needs an
// overload approval. In the tree it's the semester's "skill points".
export const SEMESTER_UNITS = 24;

export type Status = "done" | "taking" | "later" | "open" | "next" | "locked" | "excluded";
export type Role = "core" | "stream" | "ict";

export interface Tile {
  course: Course;
  status: Status;
  needed: boolean;
  prereqMet: boolean;
  submitted: boolean; // for "taking": the semester is submitted
  blockedBy: string[]; // incompatible courses already taken or picked
  takenIn?: string; // semester id, for done / taking / later
  plannedId?: number; // planned_courses row, when picked here
  roles: Role[];
  links: Map<string, "required" | "alternative">; // prerequisite courses
}

export type Phase = Status | "open-needed" | "locked-needed" | "next-needed";
export const phaseOf = (t: Tile): Phase =>
  t.needed && (t.status === "open" || t.status === "locked" || t.status === "next") ? `${t.status}-needed` : t.status;

export function stateLabel(t: Tile): string {
  switch (phaseOf(t)) {
    case "done":
      return "Done";
    case "taking":
      return t.submitted ? "Enrolled" : "Selected";
    case "later":
      return `Taking ${t.takenIn}`;
    case "open-needed":
      return "Needed · open";
    case "open":
      return "Open";
    case "next-needed":
      return "Needed · next";
    case "next":
      return "Next";
    case "locked-needed":
      return "Needed · locked";
    case "locked":
      return "Locked";
    case "excluded":
      return "Excluded";
  }
}

// How far the student's courses (done and picked) go toward one major or
// specialisation.
export interface MajorProgress {
  stream: Stream;
  units: number; // counted toward it
  of: number;
  met: boolean;
  rules: RuleProgress[];
}

export interface PlanView {
  semester: Semester;
  student: Student;
  program?: Program;
  major?: Stream; // the major/specialisation being looked at, in the Majors tab
  majors: MajorProgress[]; // every one of the program's, furthest along first
  tiles: Map<string, Tile>;
  planned: Tile[]; // in this semester
  submitted: boolean; // this semester's selection is submitted
  next?: Semester; // the semester after this one
  drafts: Semester[]; // earlier semesters with picks not submitted (they don't count)
  load: number;
  cap: number; // units this semester can take: a full load, or what the program has left
  unitsDone: number; // units submitted in earlier semesters
  finished: boolean; // the program's units are reached, with this semester's (submitted) courses
  beyond: boolean; // they were reached before this semester: nothing more to take
  broken: Tile[]; // picked here, prerequisites no longer met
  progress: RuleProgress[]; // the program's rules, counting the closest major
}

function allPlanned(): (PlannedCourse & { startsOn: string; submitted: boolean })[] {
  const starts = new Map(db.select().from(semesters).all().map((s) => [s.id, s.startsOn]));
  const submitted = new Set(db.select().from(enrolments).all().map((e) => e.semesterId));
  return db
    .select()
    .from(plannedCourses)
    .orderBy(asc(plannedCourses.id))
    .all()
    .map((p) => ({ ...p, startsOn: starts.get(p.semesterId) ?? "", submitted: submitted.has(p.semesterId) }));
}

export const programAliases = (program?: Program) => (program ? [program.short] : []);

function rolesOf(code: string, program?: Program, stream?: Stream): Role[] {
  const roles: Role[] = [];
  for (const rule of program?.rules ?? []) {
    if (rule.kind === "courses" && rule.courses.includes(code)) roles.push(rule.label.startsWith("ICT") ? "ict" : "core");
  }
  if (stream?.rules.some((r) => r.kind === "courses" && r.courses.includes(code))) roles.push("stream");
  return [...new Set(roles)];
}

// Courses on a course-list rule that isn't filled yet (counting this
// semester's picks). "Up to N" lists never make a course needed.
function neededCourses(results: RuleProgress[]): Set<string> {
  const needed = new Set<string>();
  for (const r of results) {
    if (r.stream) for (const code of neededCourses(r.stream.rules)) needed.add(code);
    if (r.rule.kind === "courses" && r.rule.mode !== "max" && !r.met) {
      for (const code of r.rule.courses) if (!r.courses.includes(code)) needed.add(code);
    }
  }
  return needed;
}

export function planView(semesterId: string, majorCode?: string): PlanView | undefined {
  const semester = getSemester(semesterId);
  if (!semester) return undefined;
  const student = getStudent();
  const program = getProgram(student.programCode);
  const major = majorCode && program?.streams.includes(majorCode) ? STREAMS.get(majorCode) : undefined;

  const rows = allPlanned();
  // only submitted semesters count as done
  const before = rows.filter((r) => r.startsOn < semester.startsOn && r.submitted);
  const drafts = [...new Set(rows.filter((r) => r.startsOn < semester.startsOn && !r.submitted).map((r) => r.semesterId))];
  const here = rows.filter((r) => r.semesterId === semester.id);
  const after = rows.filter((r) => r.startsOn > semester.startsOn);

  const unitsOf = (code: string) => getCourse(code)?.units ?? 6;
  const taken = (list: typeof rows) => list.map((r) => ({ code: r.code, units: unitsOf(r.code) }));
  const programs = programAliases(program);
  const ctx: RequisiteContext = { done: taken(before), current: new Set(here.map((r) => r.code)), programs };
  // as it will be once this semester is done
  const nextCtx: RequisiteContext = { done: taken([...before, ...here]), current: new Set(), programs };
  const takenCodes = new Set([...before, ...here].map((r) => r.code));
  const submitted = isSubmitted(semester.id);

  const counted: CountedCourse[] = [...before, ...here].map((r) => ({
    code: r.code,
    units: unitsOf(r.code),
    // once submitted, this semester's courses count as done, not planned
    planned: r.semesterId === semester.id && !submitted,
    td: getCourse(r.code)?.transdisciplinary ?? false,
  }));
  const run = (stream?: Stream) => (program ? progress(program.rules, counted, unitsOf, stream) : []);
  const majors: MajorProgress[] = (program?.streams ?? [])
    .map((code) => STREAMS.get(code)!)
    .map((stream) => {
      const r = run(stream).find((x) => x.stream)!;
      return { stream, units: r.done + r.planned, of: stream.minUnits, met: r.met, rules: r.stream!.rules };
    })
    .sort((a, b) => b.units - a.units);
  const closest = majors[0]?.units ? majors[0].stream : undefined;
  // Needed: the program's own rules, plus the looked-at major's.
  const needed = neededCourses(run());
  if (major) for (const code of neededCourses(majors.find((m) => m.stream === major)!.rules)) needed.add(code);

  // The tree covers the program's level; without a program, both levels.
  const pool = coursesAt(program?.level);
  const extra = rows.map((r) => getCourse(r.code)).filter((c): c is Course => !!c);
  const tiles = new Map<string, Tile>();
  for (const course of [...pool, ...extra]) {
    if (tiles.has(course.code)) continue;
    const doneRow = before.find((r) => r.code === course.code);
    const hereRow = here.find((r) => r.code === course.code);
    const laterRow = after.find((r) => r.code === course.code);
    const prereqMet = meets(course.requires, ctx);
    const blockedBy = [...takenCodes].filter(
      (code) => code !== course.code && (course.incompatibleWith.includes(code) || getCourse(code)?.incompatibleWith.includes(course.code)),
    );
    const status: Status = doneRow
      ? "done"
      : hereRow
        ? "taking"
        : laterRow
          ? "later"
          : blockedBy.length
            ? "excluded"
            : prereqMet
              ? "open"
              : meets(course.requires, nextCtx)
                ? "next"
                : "locked";
    tiles.set(course.code, {
      course,
      status,
      needed: needed.has(course.code) && status !== "excluded",
      prereqMet,
      submitted,
      blockedBy,
      takenIn: (doneRow ?? hereRow ?? laterRow)?.semesterId,
      plannedId: hereRow?.id,
      roles: rolesOf(course.code, program, major),
      links: PREREQUISITES.get(course.code) ?? new Map(),
    });
  }

  const planned = here.map((r) => tiles.get(r.code)).filter((t): t is Tile => !!t);
  const load = planned.reduce((n, t) => n + t.course.units, 0);
  // The program ends at its total units (BCOMP 144, MCOMP 96): the last
  // semester only takes what's left, and there's no semester after it.
  const unitsDone = before.reduce((n, r) => n + unitsOf(r.code), 0);
  const total = program?.minUnits ?? Infinity;
  return {
    semester,
    student,
    program,
    major,
    majors,
    tiles,
    planned,
    submitted,
    next: nextSemester(semester.id),
    drafts: drafts.map((id) => getSemester(id)!),
    load,
    cap: Math.max(0, Math.min(SEMESTER_UNITS, total - unitsDone)),
    unitsDone,
    finished: submitted && unitsDone + load >= total,
    beyond: unitsDone >= total,
    broken: planned.filter((t) => !t.prereqMet),
    progress: run(closest),
  };
}

export type AddCheck = { ok: true } | { ok: false; reason: string };

export function canAdd(view: PlanView, code: string): AddCheck {
  const tile = view.tiles.get(code);
  if (!tile) return { ok: false, reason: `${code} isn't in the catalogue for your program.` };
  if (view.beyond) return { ok: false, reason: `You've completed all ${view.program!.minUnits} units of the ${view.program!.title} before ${view.semester.label}.` };
  if (view.submitted) return { ok: false, reason: `${view.semester.label} is submitted. Change it to add more.` };
  switch (tile.status) {
    case "done":
      return { ok: false, reason: `You completed ${code} in ${tile.takenIn}.` };
    case "taking":
      return { ok: false, reason: `${code} is already in this plan.` };
    case "later":
      return { ok: false, reason: `${code} is planned for ${tile.takenIn}.` };
    case "excluded":
      return { ok: false, reason: `${code} can't be taken with ${tile.blockedBy.join(", ")}.` };
    case "next":
      return { ok: false, reason: `${code} opens next semester, once this semester's courses are done.` };
    case "locked":
      return { ok: false, reason: `${code}'s prerequisites aren't met yet.` };
  }
  if (view.load + tile.course.units > view.cap) {
    return {
      ok: false,
      reason:
        view.cap < SEMESTER_UNITS
          ? `Your selection is full: the ${view.program!.title} only has ${view.cap} units left.`
          : `Your selection is full: ${view.load} of ${SEMESTER_UNITS} units (4 courses).`,
    };
  }
  return { ok: true };
}

// --- the tree's layout -------------------------------------------------------

export type Tab = "program" | "majors" | "all";

export const tabsFor = (program?: Program): { id: Tab; label: string }[] => [
  { id: "program", label: "Program path" },
  { id: "majors", label: program?.streamKind === "specialisation" ? "Specialisations" : "Majors" },
  { id: "all", label: "All courses" },
];

export interface Tier {
  tier: number;
  tiles: Tile[];
}

/**
 * The courses a tab shows, in tiers by course level, each tier in course-code
 * order — a tile keeps its place when its state changes (the colour and the
 * words under it say the state).
 * - Program path: what's taken or next, the program's own courses, and what
 *   its needed courses need first.
 * - Majors: the looked-at major's courses, and what its needed ones need
 *   first.
 * - All courses: the program's whole level.
 */
export function tiers(view: PlanView, tab: Tab): Tier[] {
  const shown = new Set<string>();
  const tiles = [...view.tiles.values()];
  const level = view.program?.level;
  if (tab === "all" || !view.program) {
    for (const t of tiles) if (!level || t.course.level === level) shown.add(t.course.code);
  } else if (tab === "majors") {
    for (const t of tiles) if (t.roles.includes("stream")) shown.add(t.course.code);
  } else {
    for (const t of tiles) {
      const onPath =
        ["done", "taking", "later", "next"].includes(t.status) || t.needed || (t.roles.includes("core") && t.status !== "excluded");
      if (onPath) shown.add(t.course.code);
    }
  }
  if (tab !== "all") {
    // what the needed courses need first, all the way down
    const queue = [...shown].filter((code) => view.tiles.get(code)?.needed);
    while (queue.length) {
      for (const pre of view.tiles.get(queue.pop()!)?.links.keys() ?? []) {
        const t = view.tiles.get(pre);
        if (t && t.course.level === level && t.status !== "excluded" && !shown.has(pre)) {
          shown.add(pre);
          queue.push(pre);
        }
      }
    }
  }
  const byTier = new Map<number, Tile[]>();
  for (const code of shown) {
    const t = view.tiles.get(code)!;
    byTier.set(t.course.tier, [...(byTier.get(t.course.tier) ?? []), t]);
  }
  return [...byTier.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tier, ts]) => ({ tier, tiles: ts.sort((a, b) => a.course.code.localeCompare(b.course.code)) }));
}

// Courses this one opens up: those that name it as a prerequisite.
export function unlocks(view: PlanView, code: string): Tile[] {
  return [...view.tiles.values()].filter((t) => t.links.has(code));
}
