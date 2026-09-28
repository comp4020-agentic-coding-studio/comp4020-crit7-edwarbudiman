// Program, major and specialisation rules, and a student's progress against
// them.
//
// Majors and specialisations are parsed from their Programs and Courses
// "Requirements" text, which is a list of lines like:
//   24 units from completion of the following compulsory courses:
//   A minimum of 6 units from completion of courses from the following list:
//   A maximum of 18 units may come from completion of 1000-level courses
//   COMP2310 Systems Networks and Concurrency
// Programs are few and irregular, so src/lib/catalogue.ts transcribes theirs.

export interface CourseFilter {
  subjects?: string[]; // "COMP", "ENGN"
  levels?: number[]; // 1000 … 8000
  td?: boolean; // tagged Transdisciplinary Problem-Solving
  exclude?: string[];
}

export type Rule =
  | { kind: "total"; label: string; units: number }
  // all: every course listed; min: at least `units`; max: counts up to
  // `units`; exactly: `units` from the list (more don't count here)
  | { kind: "courses"; label: string; mode: "all" | "min" | "max" | "exactly"; units: number; courses: string[] }
  // A constraint over courses already counted (e.g. "max 60 units of
  // 1000-level"), or — with `unclaimed` — its own pool of courses no other
  // rule has used ("18 units of further COMP/ENGN courses").
  | { kind: "filter"; label: string; mode: "min" | "max"; units: number; filter: CourseFilter; unclaimed?: boolean }
  // The program's major/specialisation; `fallback` is what counts when none
  // is chosen (BCOMP: 48 units of COMP).
  | { kind: "stream"; label: string; units: number; fallback?: { label: string; filter: CourseFilter } }
  | { kind: "electives"; label: string; units: number };

export function parseRuleText(text: string): { rules: Rule[]; notes: string[] } {
  const rules: Rule[] = [];
  const notes: string[] = [];
  let group: Extract<Rule, { kind: "courses" }> | null = null;

  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const code = /^([A-Z]{4}\d{4})\b/.exec(line)?.[1];
    if (code) {
      if (!group) {
        group = { kind: "courses", label: "Compulsory courses", mode: "all", units: 0, courses: [] };
        rules.push(group);
      }
      if (!group.courses.includes(code)) group.courses.push(code);
      continue;
    }
    if (/^(AND|OR)$/i.test(line)) {
      group = null;
      continue;
    }

    const listed = /following list|following compulsory|from the following|compulsory courses/i.test(line);
    const levelAt = line.search(/[1-8]000[\s\S]*?level courses/);
    if (!listed && levelAt >= 0) {
      const counts = [...line.slice(0, levelAt).matchAll(/(\d+) units/g)];
      const levels = [...line.slice(levelAt).matchAll(/\b([1-8]000)\b/g)].map((m) => Number(m[1]));
      if (counts.length && !/subject area/i.test(line)) {
        const units = Number(counts.at(-1)![1]);
        const mode = /maximum/i.test(line) ? "max" : "min";
        // (a constraint can sit between a list's heading and its courses)
        rules.push({ kind: "filter", label: `${levels.join("/")}-level courses`, mode, units, filter: { levels } });
        continue;
      }
    }

    const units = Number(/(\d+) units/.exec(line)?.[1] ?? NaN);
    if (!Number.isNaN(units) && /subject area/i.test(line)) {
      // "6 units from completion of an 8000-level course from the subject area
      // COMP Computing, excluding the project courses (COMP8715, …)"
      const [kept, excluded = ""] = line.split(/excluding/i);
      const levels = [...kept!.matchAll(/\b([1-8]000)\b/g)].map((m) => Number(m[1]));
      const subjects = [...kept!.matchAll(/subject area ([A-Z]{4})/g)].map((m) => m[1]!);
      rules.push({
        kind: "filter",
        label: `${levels.join("/")}-level ${subjects.join("/")} course`,
        mode: "min",
        units,
        filter: { subjects, levels, exclude: [...excluded.matchAll(/[A-Z]{4}\d{4}/g)].map((m) => m[0]) },
        unclaimed: true,
      });
      group = null;
      continue;
    }
    if (!Number.isNaN(units) && listed) {
      const mode = /compulsory/i.test(line) ? "all" : /^A minimum/i.test(line) ? "min" : /^A maximum/i.test(line) ? "max" : /requires the completion/i.test(line) ? "min" : "exactly";
      const label =
        mode === "all" ? "Compulsory courses" : mode === "min" ? `At least ${units} units from` : mode === "max" ? `Up to ${units} units from` : `${units} units from`;
      group = { kind: "courses", label, mode, units, courses: [] };
      rules.push(group);
      continue;
    }
    if (/incompatible|not available|^Note:/i.test(line)) notes.push(line);
    // anything else ("This major requires the completion of 48 units, of
    // which:", "The 24 units must consist of:") only introduces the lines below
    group = /consist of|of which|including|must include/i.test(line) ? null : group;
  }
  return { rules, notes };
}

// --- progress --------------------------------------------------------------

export interface CountedCourse {
  code: string;
  units: number;
  planned: boolean; // in the semester being planned, not yet completed
  td: boolean;
}

export interface RuleProgress {
  rule: Rule;
  label: string;
  done: number; // units from completed courses
  planned: number; // units from the semester being planned
  need: number;
  met: boolean; // with the plan included
  optional: boolean; // "up to" rules: nothing is missing
  over: boolean; // a maximum is exceeded
  courses: string[]; // courses that count toward this rule
  stream?: { code: string; title: string; minUnits: number; rules: RuleProgress[] };
}

export interface StreamRules {
  code: string;
  title: string;
  minUnits: number;
  rules: Rule[];
}

const levelOf = (code: string) => Number(code[4]) * 1000;

export const matchesFilter = (c: CountedCourse, f: CourseFilter) =>
  (!f.subjects || f.subjects.includes(c.code.slice(0, 4))) &&
  (!f.levels || f.levels.includes(levelOf(c.code))) &&
  (!f.td || c.td) &&
  !f.exclude?.includes(c.code);

// Completed courses count before planned ones, so a rule fills from what's
// already done.
const byDoneFirst = (a: CountedCourse, b: CountedCourse) => Number(a.planned) - Number(b.planned);

function sum(courses: CountedCourse[]) {
  let done = 0;
  let planned = 0;
  for (const c of courses) {
    if (c.planned) planned += c.units;
    else done += c.units;
  }
  return { done, planned };
}

// Take courses in order until `cap` units are reached.
function take(courses: CountedCourse[], cap: number) {
  const taken: CountedCourse[] = [];
  let units = 0;
  for (const c of [...courses].sort(byDoneFirst)) {
    if (units >= cap) break;
    taken.push(c);
    units += c.units;
  }
  return taken;
}

/**
 * Progress against a rule list. Course rules and streams claim the courses
 * they count, in order, so no course counts twice toward the program; filters
 * without `unclaimed` are constraints over the courses in scope; electives are
 * whatever is left.
 *
 * The one exception is a major or specialisation: it counts every course the
 * student has, including ones a program rule already claimed. So each one's
 * progress stands alone — take what two majors ask for and both show complete,
 * whichever rule the program counted a shared course under.
 */
export function progress(
  rules: Rule[],
  counted: CountedCourse[],
  unitsOf: (code: string) => number,
  stream?: StreamRules,
  nested = false,
): RuleProgress[] {
  const claimed = new Set<string>();
  const results: (RuleProgress | null)[] = rules.map(() => null);
  const unclaimed = () => counted.filter((c) => !claimed.has(c.code));
  const result = (rule: Rule, courses: CountedCourse[], need: number, extra: Partial<RuleProgress> = {}): RuleProgress => {
    const { done, planned } = sum(courses);
    return {
      rule,
      label: rule.label,
      done,
      planned,
      need,
      met: done + planned >= need,
      optional: false,
      over: false,
      courses: courses.map((c) => c.code),
      ...extra,
    };
  };

  rules.forEach((rule, i) => {
    if (rule.kind === "courses") {
      const inList = unclaimed().filter((c) => rule.courses.includes(c.code));
      if (rule.mode === "all") {
        for (const c of inList) claimed.add(c.code);
        const need = rule.courses.reduce((n, code) => n + unitsOf(code), 0);
        results[i] = result(rule, inList, need, { met: rule.courses.every((code) => inList.some((c) => c.code === code)) });
      } else {
        const counts = rule.mode === "min" ? inList : take(inList, rule.units);
        for (const c of counts) claimed.add(c.code);
        results[i] = result(rule, counts, rule.units, rule.mode === "max" ? { met: true, optional: true } : {});
      }
    } else if (rule.kind === "stream") {
      if (stream) {
        const inner = progress(stream.rules, counted, unitsOf, undefined, true);
        const counts = counted.filter((c) => inner.some((r) => r.rule.kind !== "filter" && r.courses.includes(c.code)));
        for (const c of counts) claimed.add(c.code);
        const base = result(rule, counts, stream.minUnits);
        results[i] = {
          ...base,
          label: stream.title,
          met: base.met && inner.every((r) => r.met),
          stream: { code: stream.code, title: stream.title, minUnits: stream.minUnits, rules: inner },
        };
      } else if (rule.fallback) {
        const counts = take(unclaimed().filter((c) => matchesFilter(c, rule.fallback!.filter)), rule.units);
        for (const c of counts) claimed.add(c.code);
        results[i] = result(rule, counts, rule.units, { label: rule.fallback.label });
      } else {
        results[i] = result(rule, [], rule.units, { label: `Choose a ${rule.label.toLowerCase()}` });
      }
    } else if (rule.kind === "filter" && rule.unclaimed) {
      const counts = take(unclaimed().filter((c) => matchesFilter(c, rule.filter)), rule.units);
      for (const c of counts) claimed.add(c.code);
      results[i] = result(rule, counts, rule.units);
    }
  });

  // Constraints look at the courses in scope: for a program, everything; for
  // a major or specialisation, the courses it counted.
  const scope = nested ? counted.filter((c) => claimed.has(c.code)) : counted;
  rules.forEach((rule, i) => {
    if (rule.kind === "filter" && !rule.unclaimed) {
      const matching = scope.filter((c) => matchesFilter(c, rule.filter));
      if (rule.mode === "min") results[i] = result(rule, matching, rule.units);
      else {
        const r = result(rule, matching, rule.units, { optional: true });
        results[i] = { ...r, met: r.done + r.planned <= rule.units, over: r.done + r.planned > rule.units };
      }
    } else if (rule.kind === "total") {
      results[i] = result(rule, counted, rule.units);
    } else if (rule.kind === "electives") {
      results[i] = result(rule, unclaimed(), rule.units);
    }
  });
  return results.filter((r): r is RuleProgress => r !== null);
}
