// The Requirements tracker as a to-do list: each program rule (and the
// closest major's or specialisation's) turned into the step still left, in
// the order a student acts on them — named courses first, then pick-one-of
// lists, the major, unit counts, electives, and the total last.
import type { RuleProgress } from "./requirements";

// done: met by submitted courses; planned: met once this semester's
// selection is; todo: still open; info: an "up to" rule, nothing missing;
// over: a maximum is exceeded.
export type Mark = "done" | "planned" | "todo" | "info" | "over";

export interface Step {
  mark: Mark;
  lead: string; // "Take", "Foundations — pick 1:", "18 more units of 8000-level COMP"
  codes: { code: string; selected: boolean }[];
  join: "and" | "or";
  more?: string; // "a list of 15 — shown as Needed in the tree"
  bar?: { done: number; planned: number; need: number };
  nested?: Step[]; // a major's or specialisation's own rules
  order: number;
}

// Lists longer than this aren't spelled out.
const SHORT = 6;

function markOf(r: RuleProgress, nested?: Step[]): Mark {
  if (r.over) return "over";
  if (r.optional) return "info";
  if (!r.met) return "todo";
  const byDone = r.planned === 0 || r.done >= r.need;
  return byDone && (nested ?? []).every((s) => s.mark !== "planned" && s.mark !== "todo") ? "done" : "planned";
}

export function toStep(r: RuleProgress, planned: Set<string>, streamKind = "major", inStream = false): Step {
  const rule = r.rule;
  const have = r.done + r.planned;
  const left = Math.max(0, r.need - have);
  const bar = { done: r.done, planned: r.planned, need: r.need };
  const selected = (code: string) => planned.has(code) && r.courses.includes(code);
  const codes = (list: string[]) => list.map((code) => ({ code, selected: selected(code) }));

  if (rule.kind === "courses") {
    const mark = markOf(r);
    if (rule.mode === "all") {
      // what isn't done yet (selected ones stay, marked)
      const left = rule.courses.filter((c) => !r.courses.includes(c) || planned.has(c));
      const lead = mark === "done" ? `${r.label}: done` : left.length === 1 ? "Take" : "Take all of";
      return { mark, lead, codes: mark === "done" ? [] : codes(left), join: "and", order: 0 };
    }
    if (rule.mode === "max") {
      return { mark, lead: `${r.label}: up to ${rule.units} units (${have} so far)`, codes: [], join: "or", order: 6 };
    }
    const short = rule.courses.length <= SHORT;
    if (mark !== "todo") return { mark, lead: `${r.label}:`, codes: codes(r.courses), join: "and", order: 1 };
    const pickOne = left <= 6 && short;
    const prefix = r.label.startsWith("At least") || /units from$/.test(r.label) ? "" : `${r.label} — `;
    return {
      mark,
      lead: pickOne ? `${prefix}pick 1:` : `${prefix}${left} more units from${short ? ":" : ""}`,
      codes: short ? codes(rule.courses) : [],
      join: "or",
      // a major's lists are marked in its own tab, not on the program path
      more: short
        ? undefined
        : `a list of ${rule.courses.length} — ${inStream ? `see the ${streamKind === "major" ? "Majors" : "Specialisations"} tab` : "shown as Needed in the tree"}`,
      bar: pickOne ? undefined : bar,
      order: 1,
    };
  }

  if (rule.kind === "stream") {
    if (r.stream) {
      const nested = r.stream.rules.map((s) => toStep(s, planned, streamKind, true)).sort((a, b) => a.order - b.order);
      const name = r.stream.title.replace(/ (Major|Specialisation)$/, "");
      const mark = markOf(r, nested);
      return {
        mark,
        lead: mark === "todo" ? `A ${streamKind} (${r.need} units) — closest: ${name}` : `${r.stream.title}`,
        codes: [],
        join: "and",
        bar,
        nested,
        order: 2,
      };
    }
    // BCOMP without a major: its fallback, a plain unit count
    return {
      mark: markOf(r),
      lead: rule.fallback ? `${left} more units of COMP courses (or complete a major)` : `A ${streamKind} (${r.need} units) — none started yet`,
      codes: [],
      join: "and",
      bar,
      order: 2,
    };
  }

  if (rule.kind === "filter") {
    const mark = markOf(r);
    const what = r.label.replace(/^Further /, "further ");
    if (rule.mode === "max") {
      return {
        mark,
        lead: r.over ? `Over the limit: ${have} of at most ${r.need} units of ${r.label}` : `At most ${r.need} units of ${r.label} (${have} so far)`,
        codes: [],
        join: "and",
        order: 6,
      };
    }
    return { mark, lead: mark === "todo" ? `${left} more units of ${what}` : `${r.need} units of ${what}`, codes: [], join: "and", bar, order: 3 };
  }

  if (rule.kind === "electives") {
    const mark = markOf(r);
    return { mark, lead: mark === "todo" ? `${left} more units of electives — any ANU course` : `${r.need} units of electives`, codes: [], join: "and", bar, order: 4 };
  }

  // total
  return { mark: markOf(r), lead: `Total: ${r.need} units — ${have} so far`, codes: [], join: "and", bar, order: 7 };
}

/** The program's steps, split into what's left (in acting order) and what's met. */
export function checklist(progress: RuleProgress[], planned: Set<string>, streamKind = "major") {
  const steps = progress.map((r) => toStep(r, planned, streamKind)).sort((a, b) => a.order - b.order);
  return {
    left: steps.filter((s) => s.mark === "todo" || s.mark === "planned" || s.mark === "over"),
    met: steps.filter((s) => s.mark === "done" || s.mark === "info"),
  };
}
