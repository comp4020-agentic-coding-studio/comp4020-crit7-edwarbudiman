// The ANU course catalogue the planner works from. Every record comes from
// ANU Programs and Courses (programsandcourses.anu.edu.au) via the files in
// src/lib/data/ — see each file's _source, and scripts/fetch-anu-data.ts,
// which refreshes them.
//
// Courses live in the database: on boot this module loads the files into the
// `courses` and `prerequisites` tables (replacing what was there — it's
// reference data), and the planner reads them back from there. Program,
// major and specialisation rules are read straight from the files.
import { db } from "./db";
import external from "./data/external-courses.json";
import majorsData from "./data/soco-majors.json";
import soco from "./data/soco-courses.json";
import programsData from "./data/soco-programs.json";
import specsData from "./data/soco-specialisations.json";
import { type Rule, parseRuleText } from "./requirements";
import { courseLinks, parseRequisites } from "./requisites";
import { type CourseRow, courses, prerequisites } from "./schema";

export interface Course extends CourseRow {
  tier: number; // 1000, 2000, … 8000 — from the code
}

export interface Stream {
  code: string; // "SOFT-MAJ", "ARTIF-SPEC"
  kind: "major" | "specialisation";
  title: string;
  url: string;
  minUnits: number;
  rules: Rule[];
  notes: string[];
}

interface RawCourse {
  code: string;
  title: string;
  units: number;
  level: string;
  transdisciplinary?: boolean;
  incompatibleWith?: string[];
  requisiteText?: string | null;
  offeredBy?: string | null;
  catalogueYear?: number;
}

function toRow(raw: RawCourse, school: string): CourseRow {
  const { requires, notes } = parseRequisites(raw.requisiteText);
  return {
    code: raw.code,
    title: raw.title,
    units: raw.units,
    level: raw.level === "postgraduate" ? "postgraduate" : "undergraduate",
    subject: raw.code.slice(0, 4),
    school: raw.offeredBy ?? school,
    url: `https://programsandcourses.anu.edu.au/${raw.catalogueYear ?? soco._year}/course/${raw.code}`,
    requisiteText: raw.requisiteText ?? "",
    requires,
    notes,
    incompatibleWith: raw.incompatibleWith ?? [],
    transdisciplinary: !!raw.transdisciplinary,
  };
}

function loadIntoDatabase() {
  const rows = [
    ...(soco.courses as RawCourse[]).map((c) => toRow(c, soco.school)),
    ...(external.courses as RawCourse[]).map((c) => toRow(c, "Another ANU school")),
  ];
  db.transaction((tx) => {
    tx.delete(prerequisites).run();
    tx.delete(courses).run();
    for (const row of rows) {
      tx.insert(courses).values(row).run();
      for (const [requiresCode, kind] of courseLinks(row.requires)) {
        tx.insert(prerequisites).values({ courseCode: row.code, requiresCode, kind }).run();
      }
    }
  });
}

loadIntoDatabase();

export const COURSES = new Map<string, Course>(
  db
    .select()
    .from(courses)
    .all()
    .map((row) => [row.code, { ...row, tier: Number(row.code[4]) * 1000 }]),
);

export const getCourse = (code: string) => COURSES.get(code.toUpperCase());

// A course's prerequisite links, from the prerequisites table.
export const PREREQUISITES = new Map<string, Map<string, "required" | "alternative">>();
for (const link of db.select().from(prerequisites).all()) {
  const links = PREREQUISITES.get(link.courseCode) ?? new Map();
  links.set(link.requiresCode, link.kind);
  PREREQUISITES.set(link.courseCode, links);
}

export const STREAMS = new Map<string, Stream>();
for (const m of majorsData.majors) {
  const { rules, notes } = parseRuleText(m.requirementsText);
  STREAMS.set(m.code, { code: m.code, kind: "major", title: m.title, url: m.url, minUnits: m.minUnits, rules, notes });
}
for (const s of specsData.specialisations) {
  const { rules, notes } = parseRuleText(s.requirementsText);
  STREAMS.set(s.code, { code: s.code, kind: "specialisation", title: s.title, url: s.url, minUnits: s.minUnits, rules, notes });
}

// --- programs ---------------------------------------------------------------
// The two School of Computing award programs. Their rules are transcribed
// from each program's requirementsText in soco-programs.json (the program
// page's "Requirements" section); the line each rule comes from is quoted.

export interface Program {
  code: string;
  short: string; // how requisite texts name it: "BCOMP", "MCOMP"
  title: string;
  level: Course["level"];
  url: string;
  minUnits: number;
  duration: string;
  streamKind: Stream["kind"];
  streams: string[];
  streamRequired: boolean; // BCOMP accepts 48 units of COMP instead of a major
  rules: Rule[];
}

const raw = (code: string) => {
  const p = programsData.programs.find((x) => x.code === code);
  if (!p) throw new Error(`program ${code} missing from soco-programs.json`);
  return p;
};

const bcomp = raw("BCOMP");
const mcomp = raw("7706XMCOMP");

export const PROGRAMS: Program[] = [
  {
    code: bcomp.code,
    short: "BCOMP",
    title: bcomp.title,
    level: "undergraduate",
    url: bcomp.url,
    minUnits: bcomp.minUnits,
    duration: bcomp.duration,
    streamKind: "major",
    streams: (bcomp.majors ?? []).map((m) => m.code),
    streamRequired: false,
    rules: [
      // "The Bachelor of Computing requires completion of 144 units"
      { kind: "total", label: "Total units", units: 144 },
      // "A minimum of 12 units … courses tagged as Transdisciplinary Problem-Solving"
      { kind: "filter", label: "Transdisciplinary Problem-Solving", mode: "min", units: 12, filter: { td: true } },
      // "A minimum of 24 units … 3000 and 4000-level COMP courses"
      { kind: "filter", label: "3000/4000-level COMP", mode: "min", units: 24, filter: { subjects: ["COMP"], levels: [3000, 4000] } },
      // "A maximum of 60 units may come from completion of 1000-level courses"
      { kind: "filter", label: "1000-level courses", mode: "max", units: 60, filter: { levels: [1000] } },
      { kind: "courses", label: "Programming as Problem Solving", mode: "exactly", units: 6, courses: ["COMP1100", "COMP1130"] },
      { kind: "courses", label: "Structured Programming", mode: "exactly", units: 6, courses: ["COMP1110", "COMP1140"] },
      { kind: "courses", label: "Discrete mathematics", mode: "exactly", units: 6, courses: ["MATH1005", "MATH2222"] },
      // "24 units from the completion of the following compulsory courses"
      { kind: "courses", label: "Compulsory courses", mode: "all", units: 24, courses: bcomp.compulsoryCourses },
      // "48 units from … the subject area COMP Computer Science OR completion of one of the following computing majors"
      { kind: "stream", label: "Computing major", units: 48, fallback: { label: "48 units of COMP courses", filter: { subjects: ["COMP"] } } },
      // "6 units from completion of Information and Communications Technology-related courses"
      {
        kind: "courses",
        label: "ICT-related course",
        mode: "exactly",
        units: 6,
        courses: [
          "ARTH2181", "ASIA3032", "DESN2010", "ENGN1211", "ENVS2015", "INFS2024", "INFS3002", "INFS3024", "MATH1013",
          "MATH1115", "MATH2301", "MATH2307", "MGMT2009", "MUSI3309", "SCOM3029", "SOCY2038", "SOCY2166", "STAT1003", "STAT1008",
        ],
      },
      // "A minimum of 48 units from completion of elective courses offered by ANU"
      { kind: "electives", label: "Electives (any ANU course)", units: 48 },
    ],
  },
  {
    code: mcomp.code,
    short: "MCOMP",
    title: mcomp.title,
    level: "postgraduate",
    url: mcomp.url,
    minUnits: mcomp.minUnits,
    duration: mcomp.duration,
    streamKind: "specialisation",
    streams: (mcomp.specialisations ?? []).map((s) => (s as { code?: string }).code).filter((c): c is string => !!c),
    streamRequired: true,
    rules: [
      // "The Master of Computing requires the completion of 96 units"
      { kind: "total", label: "Total units", units: 96 },
      // "A minimum of 24 units must come from completion of 8000-level COMP courses"
      { kind: "filter", label: "8000-level COMP", mode: "min", units: 24, filter: { subjects: ["COMP"], levels: [8000] } },
      // "30 units from completion of the following compulsory courses"
      { kind: "courses", label: "Compulsory courses", mode: "all", units: 30, courses: mcomp.compulsoryCourses },
      // "A minimum of 6 units from completion of foundational courses"
      { kind: "courses", label: "Foundations", mode: "min", units: 6, courses: ["MATH6005", "COMP6260"] },
      // "A maximum of 12 units from completion of project courses"
      { kind: "courses", label: "Project courses", mode: "max", units: 12, courses: mcomp.capstoneCourses ?? [] },
      // "24 units from the completion of one of the following Specialisations"
      { kind: "stream", label: "Specialisation", units: 24 },
      // "18 units from completion of further 6000, 7000 or 8000 level courses … COMP … ENGN"
      {
        kind: "filter",
        label: "Further COMP/ENGN courses",
        mode: "min",
        units: 18,
        filter: { subjects: ["COMP", "ENGN"], levels: [6000, 7000, 8000] },
        unclaimed: true,
      },
      // "6 units from completion of elective courses offered by ANU"
      { kind: "electives", label: "Elective (any ANU course)", units: 6 },
    ],
  },
];

export const getProgram = (code: string | null | undefined) => PROGRAMS.find((p) => p.code === code);

// Courses at a level (a program's students choose from theirs); all of them
// when no level is given.
export const coursesAt = (level?: Course["level"]) => [...COURSES.values()].filter((c) => !level || c.level === level);


export const catalogueSources = {
  courses: soco._source,
  external: external._source,
  programs: programsData._source,
  majors: majorsData._source,
  specialisations: specsData._source,
  fetchedOn: soco._fetchedOn,
};
