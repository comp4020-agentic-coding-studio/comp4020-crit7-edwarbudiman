import { describe, expect, it } from "vitest";
import { COURSES, PROGRAMS, STREAMS, getCourse } from "../src/lib/catalogue";
import { progress } from "../src/lib/requirements";
import { type Req, meets, parseRequisites } from "../src/lib/requisites";
import { DEMO_HISTORY } from "../src/lib/demo";

// Contracts of the course data and the rules read from it. These run on the
// modules directly — no server needed.

const fmt = (r: Req | null): string => {
  if (!r) return "—";
  switch (r.kind) {
    case "course":
      return r.code + (r.concurrent ? "~" : "");
    case "all":
      return `(${r.of.map(fmt).join(" & ")})`;
    case "any":
      return `(${r.of.map(fmt).join(" | ")})`;
    case "units":
      return `[${r.units}u ${r.subjects.join("/") || "any"}${r.levels.length ? ` ${r.levels.join("/")}` : ""}]`;
    case "program":
      return `P:${r.code}`;
    case "note":
      return "note";
  }
};
const parsed = (code: string) => fmt(getCourse(code)!.requires);

describe("requisite parser: AND / OR", () => {
  it("reads a list of alternatives as one-of, not all-of", () => {
    expect(parsed("COMP1110")).toBe("(COMP1100 | COMP1130 | COMP1730)");
  });

  it("binds an inline 'or' tighter than AND", () => {
    expect(parsed("COMP2310")).toBe("((COMP1110 | COMP1140) & (COMP2300 | ENGN2219))");
    expect(parsed("COMP3703")).toBe("((COMP2300 | ENGN2219) & COMP2700)");
  });

  it("treats an OR on its own line as a split between whole alternatives", () => {
    expect(parsed("COMP4670")).toBe("(COMP3670 | ((COMP1110 | COMP1140) & (MATH1014 | MATH1115 | MATH1116)))");
    // ENGN4528's text has an extra ")" — it's ignored, not a crash
    expect(parsed("ENGN4528")).toBe("((ENGN2228 & (COMP1100 | COMP1130 | COMP1730)) | COMP2120 | COMP3600)");
  });

  it("reads 'COMP6310/2310' as either course", () => {
    expect(parsed("COMP8300")).toContain("COMP6310 | COMP2310");
  });

  it("keeps unit counts, program enrolment and 'or currently enrolled' as their own conditions", () => {
    expect(parsed("COMP2300")).toBe("((COMP1100 | COMP1130 | COMP1730) & [6u MATH 1000])");
    expect(parsed("COMP4650")).toBe("((COMP1600 | COMP2100) & [12u COMP/INFS 3000/4000])");
    expect(parsed("COMP6300")).toBe("(P:MCOMP | P:VCOMP | COMP6710 | COMP7710 | COMP1110)");
    expect(parsed("COMP2120")).toBe("COMP2100~");
  });

  it("drops conditions meant for other programs' students", () => {
    // COMP2100's extra COMP1600 applies to Bachelor of Science students only
    expect(parsed("COMP2100")).toBe("((COMP1110 | COMP1140) & [6u MATH 1000])");
  });

  it("parses every course without losing a named course: each is in the tree or a note", () => {
    for (const course of COURSES.values()) {
      const named = new Set(
        (course.requisiteText.split(/Incompatible|not able to enrol|may not enrol|cannot enrol/i)[0] ?? "").match(/\b[A-Z]{4}\d{4}\b/g) ?? [],
      );
      const kept = JSON.stringify(course.requires) + course.notes.join(" ");
      for (const code of named) expect(kept, `${course.code} lost ${code}`).toContain(code);
    }
  });

  it("checks a tree against what's been done", () => {
    const { requires } = parseRequisites("You must have completed COMP1110 or COMP1140 AND COMP2300 or ENGN2219.");
    const ctx = (codes: string[]) => ({ done: codes.map((code) => ({ code, units: 6 })), current: new Set<string>(), programs: [] });
    expect(meets(requires, ctx(["COMP1110"]))).toBe(false);
    expect(meets(requires, ctx(["COMP1110", "ENGN2219"]))).toBe(true);
  });
});

describe("programs, majors and specialisations", () => {
  it("has both School of Computing programs, each with its streams resolved", () => {
    expect(PROGRAMS.map((p) => p.code)).toEqual(["BCOMP", "7706XMCOMP"]);
    const [bcomp, mcomp] = PROGRAMS;
    expect(bcomp!.streams).toHaveLength(7);
    expect(mcomp!.streams).toEqual(["ARTIF-SPEC", "COMP-SPEC", "CMSY-SPEC", "DTSC-SPEC", "HCCM-SPEC", "MCHL-SPEC", "SOFT-SPEC"]);
    for (const p of PROGRAMS) for (const code of p.streams) expect(STREAMS.get(code), code).toBeTruthy();
  });

  it("every course a rule names is in the catalogue", () => {
    const rules = [...PROGRAMS.flatMap((p) => p.rules), ...[...STREAMS.values()].flatMap((s) => s.rules)];
    for (const rule of rules) {
      if (rule.kind === "courses") for (const code of rule.courses) expect(getCourse(code), code).toBeTruthy();
    }
  });

  it("reads a major's compulsory, minimum and maximum lists", () => {
    const soft = STREAMS.get("SOFT-MAJ")!;
    const lists = soft.rules.filter((r) => r.kind === "courses").map((r) => (r.kind === "courses" ? [r.mode, r.units, r.courses.length] : []));
    expect(lists).toEqual([
      ["all", 24, 3],
      ["min", 12, 5],
      ["max", 12, 7],
    ]);
  });

  it("counts a course toward one rule only", () => {
    const bcomp = PROGRAMS[0]!;
    const counted = ["COMP1100", "COMP1110", "COMP2120", "COMP2400"].map((code) => ({ code, units: 6, planned: false, td: false }));
    const soft = STREAMS.get("SOFT-MAJ")!;
    const result = progress(bcomp.rules, counted, (c) => getCourse(c)?.units ?? 6, soft);
    const major = result.find((r) => r.rule.kind === "stream")!;
    const electives = result.find((r) => r.rule.kind === "electives")!;
    expect(major.courses).toContain("COMP2120");
    expect(electives.courses).not.toContain("COMP2120");
    expect(result.find((r) => r.label === "Compulsory courses")!.courses).toEqual(["COMP2400"]);
  });
});

describe("major and specialisation progress", () => {
  const unitsOf = (c: string) => getCourse(c)?.units ?? 6;
  const take = (codes: string[]) => codes.map((code) => ({ code, units: unitsOf(code), planned: false, td: false }));
  const streamOf = (program: (typeof PROGRAMS)[number], codes: string[], stream: string) =>
    progress(program.rules, take(codes), unitsOf, STREAMS.get(stream)).find((r) => r.stream)!;

  it("shows every one complete whose courses are taken, even when they share courses", () => {
    const mcomp = PROGRAMS[1]!;
    // Data Science and Machine Learning share COMP8490 and COMP8600
    const codes = [...mcomp.rules.flatMap((r) => (r.kind === "courses" && r.mode === "all" ? r.courses : [])),
      "COMP6240", "COMP8410", "COMP8490", "COMP8600", "COMP6670", "COMP6528", "COMP8650"];
    expect(streamOf(mcomp, codes, "DTSC-SPEC").met).toBe(true);
    expect(streamOf(mcomp, codes, "MCHL-SPEC").met).toBe(true);
  });

  it("counts a course the program already claimed toward a specialisation too", () => {
    const mcomp = PROGRAMS[1]!;
    // COMP6120 is an MCOMP compulsory course and a Software Development one
    const codes = ["COMP6120", "ENGN8100", "COMP8260", "COMP6240", "COMP6331"];
    expect(getCourse("COMP8260"), "an 8000-level COMP course").toBeTruthy();
    expect(streamOf(mcomp, codes, "SOFT-SPEC").met).toBe(true);
  });
});

describe("demo history", () => {
  it("only has real courses, each with its prerequisites met by earlier semesters", () => {
    const done: { code: string; units: number }[] = [];
    for (const [semester, codes] of Object.entries(DEMO_HISTORY)) {
      for (const code of codes) {
        const course = getCourse(code);
        expect(course, code).toBeTruthy();
        expect(meets(course!.requires, { done, current: new Set(codes), programs: ["BCOMP"] }), `${code} unlocked in ${semester}`).toBe(true);
      }
      done.push(...codes.map((code) => ({ code, units: getCourse(code)!.units })));
    }
  });
});
