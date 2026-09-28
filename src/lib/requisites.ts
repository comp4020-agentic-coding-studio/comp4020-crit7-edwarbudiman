// Turns a course's official requisite text (Programs and Courses' "Requisite
// and Incompatibility" paragraph) into an AND/OR tree the planner can check.
//
// The texts are English, but they follow a house style this parser leans on:
// - an OR on a line of its own, at the end/start of a line, after a comma or
//   semicolon, or in front of a new "have …"/"be …" clause separates whole
//   alternatives ("COMP3670 ⏎ OR ⏎ (COMP1110 AND MATH1014)");
// - AND binds tighter than that, and an inline "or" binds tightest, so
//   "COMP1110 or COMP1140 AND COMP2300 or ENGN2219" is
//   (COMP1110 | COMP1140) & (COMP2300 | ENGN2219);
// - "COMP6310/2310" is one of either code;
// - "N units of 2000-level COMP courses" is a unit count, not a course;
// - "be enrolled in the Master of Computing" is a program condition;
// - "have completed or be currently enrolled in X" lets X be taken alongside;
// - permission codes, project groups, marks and GPAs are notes: shown to the
//   student, never blocking, because the planner can't know them.
// Incompatibility clauses are cut off first — they're a separate field.

export type Req =
  | { kind: "course"; code: string; concurrent?: true }
  | { kind: "all" | "any"; of: Req[] }
  | { kind: "units"; units: number; subjects: string[]; levels: number[]; exclude: string[]; text: string }
  | { kind: "program"; code: string; text: string }
  | { kind: "note"; text: string };

export interface Requisites {
  requires: Req | null;
  notes: string[]; // advisory sentences the parser set aside
}

const INCOMPATIBLE =
  /(You are not able to enrol|You are unable to enrol|You cannot enrol|You may not enrol|You are not able to take|It is incompatible|is incompatible|Incompatible)/;

// Sentences that advise rather than require.
const ADVISORY = [
  "Students enrolled in a Bachelor of Science",
  "Additional Prerequisite",
  "Students who meet",
  "Students who have previously",
  "You will need to undergo competitive",
  "Competitive entry",
  "Finding a project",
  "A permission code is needed",
  "It should be noted",
  "Students with excellent",
  "For many students",
  "If you are not sure",
  "Students not sati",
  "In addition, if",
  "If you have previously completed",
  "CoSM students",
];

const CONCURRENT =
  /\b(?:have (?:successfully )?completed or (?:be )?(?:currently )?(?:enrolled in|studying|completing)|(?:successfully )?completed or be currently (?:enrolled in|studying)|be (?:concurrently )?enrolled in or have (?:successfully )?completed)\b:?/gi;

const NOTES: RegExp[] = [
  /\bfind a project\/supervisor/gi,
  /\b(?:have )?receive[d]? a permission code[^.\n]*/gi,
  /\bmeet the eligibility criteria[^.\n]*/gi,
  /\bhave a weighted average mark[^\n]*?(?=\s+AND\b|\n|$)/gi,
  /\bhave a GPA of[^\n]*?(?=\s+AND\b|\n|$)/gi,
];

// "MATH1115 with a mark of 60 or above": the course stays, the mark is a note.
const MARK = /\b([A-Z]{4}\d{4}) with a mark of (?:at least )?\d+(?: or above)?/g;

// "INFS2024 - Info Systems Analysis": drop the title (titles contain "and").
const TITLED =
  /\b([A-Z]{4}\d{4}) - [^\n]*?(?=\s+[A-Z]{4}\d{4}\b|\s+(?:or|OR|and|AND)\s+(?:have|be)\b|\s+\.|[.,;](?:\s|$)|\n|$)/g;

// "or with the permission of the convenor" would make every course an
// always-open alternative; it's a note, not a branch.
const PERMISSION_ALTERNATIVE = /,?\s*(?:or )?with (?:the )?(?:consent|permission) of the (?:course )?conven[eo]r\.?/gi;

// Program names as the texts spell them, most specific first.
const PROGRAMS: [RegExp, string][] = [
  [/Masters? of Computing\s*\(?Advanced\)?(?:\s*\(VCOMP\))?|\bVCOMP\b/g, "VCOMP"],
  [/Master of Computing(?:\s*\(MCOMP\))?|\bMCOMP\b/g, "MCOMP"],
  [/Master of Machine Learning and Computer Vision(?:\s*\(MMLCV\))?|\bMMLCV\b/g, "MMLCV"],
  [/Bachelor of Advanced Computing \(Research and Development\)(?: \(Honours\))?(?: \(AACRD\))?/g, "AACRD"],
  [/Bachelor of Advanced Computing(?: \(Honours\))?(?: \(AACOM\))?/g, "AACOM"],
  [/Bachelor of Engineering \(Honours\) in Software Engineering(?: \(AENSE\))?/g, "AENSE"],
  [/Bachelor of Computing \(Honours\)(?: \(HCOMP\))?/g, "HCOMP"],
  [/Bachelor of Computing(?! \(Honours\))(?: \(BCOMP\))?/g, "BCOMP"],
  [/Graduate Diploma of Computing/g, "GDCOMP"],
  [/Master of Engineering/g, "MENG"],
  [/(?:MMGNT - )?Master of Management/g, "MMGNT"],
  [/Master of Laws(?: \(MLLM\))?/g, "MLLM"],
  [/Graduate Certificate of (?:New Technologies )?Law(?: \(CLAW\))?/g, "CLAW"],
  [/Juris Doctor(?: \(MJD\))?/g, "MJD"],
  [/\bMADAN\b/g, "MADAN"],
  [/\b([A-Z]{4}-MAJ)\b/g, "$1"],
  // anything else that reads as a program name: its abbreviation, else its name
  [
    /\b(?:Bachelor|Master|Graduate Certificate|Graduate Diploma) (?:of|in) [A-Z][a-z]+(?: (?:[A-Z][a-z]+|and|of|\(Honours\)))*(?: \(([A-Z][A-Z-]{2,})\))?/g,
    "$name",
  ],
];

const UNITS_START = /\b(\d+) units?\b/g;

// Where a unit clause stops: after "courses"/"study"/"degree" (and a trailing
// "(excluding …)"), or — outside brackets it opened — before punctuation, a
// closing bracket, or a connective that starts the next condition.
function unitsEnd(rest: string): number {
  let depth = 0;
  for (let k = 0; k < rest.length; k++) {
    const ch = rest[k]!;
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) return k;
      depth--;
      continue;
    }
    if (depth > 0) continue;
    if (/[.;\n]/.test(ch)) return k;
    const tail = rest.slice(k);
    const word = /^(?:courses?|study|degree)\b(?:\s*\((?:excluding|excl\.)[^)]*\))?/.exec(tail);
    if (word && (k === 0 || /\W/.test(rest[k - 1]!))) return k + word[0].length;
    if (/^\s+(?:and|AND|or|OR|including)\s+(?:[A-Z]{4}\d{4}|have|be|you|§|\(|completed)/.test(tail)) return k;
    if (/^\s+AND\b/.test(tail) || /^\s+and\s+(?:have|be|you|completed)\b/.test(tail)) return k;
  }
  return rest.length;
}

function unitsClause(text: string, units: number): Extract<Req, { kind: "units" }> {
  const [kept, excluded = ""] = text.split(/\bexcl(?:uding|\.)/);
  const subjects = new Set<string>();
  for (const m of kept!.matchAll(/\b([A-Z]{4})S?\b(?!\d|-MAJ)/g)) subjects.add(m[1]!);
  for (const m of kept!.matchAll(/\b([A-Z]{4})[1-9]000-level/g)) subjects.add(m[1]!);
  const levels = new Set<number>();
  for (const m of kept!.matchAll(/(?:\b|[A-Z]{4})([1-9])000\b/g)) levels.add(Number(m[1]) * 1000);
  return {
    kind: "units",
    units,
    subjects: [...subjects].sort(),
    levels: [...levels].sort(),
    exclude: [...excluded.matchAll(/[A-Z]{4}\d{4}/g)].map((m) => m[0]),
    text: text.replace(/\s+/g, " ").trim(),
  };
}

type Token =
  | { t: "atom"; req: Req }
  | { t: "and" }
  | { t: "or"; strong: boolean }
  | { t: "conc" }
  | { t: "(" }
  | { t: ")" };

export function parseRequisites(raw: string | null | undefined): Requisites {
  const notes: string[] = [];
  if (!raw) return { requires: null, notes };

  let s = raw
    .replace(/\r/g, "")
    .replace(/(\d),(\d{3})/g, "$1$2") // "1,000 level"
    .replace(/\b([A-Z]{4}) (\d{4})\b/g, "$1$2") // "COMP 1030"
    .replace(/ /g, " ");
  s = s.split(INCOMPATIBLE)[0]!;
  s = s.replace(TITLED, "$1");

  for (const phrase of ADVISORY) {
    const re = new RegExp(`${phrase}[\\s\\S]*?(?:\\.(?=\\s|$)|$)`, "g");
    s = s.replace(re, (m) => {
      notes.push(m.trim());
      return " ";
    });
  }
  s = s.replace(PERMISSION_ALTERNATIVE, (m) => {
    notes.push(m.replace(/^[,\s]*(or )?/, "").trim());
    return " ";
  });
  // Advice with no requirement in it ("Students with excellent results … may
  // take this course") is kept as a note.
  if (!/\bmust\b|\brequired\b/i.test(s)) {
    if (s.trim()) notes.push(s.trim().replace(/\s+/g, " "));
    return { requires: null, notes };
  }

  // Placeholders, so later passes can't misread what earlier ones matched.
  const held: Req[] = [];
  const hold = (req: Req) => ` §${held.push(req) - 1}§ `;

  s = s.replace(CONCURRENT, " §C§ ");
  s = s.replace(MARK, (m, code: string) => {
    notes.push(m.trim());
    return code;
  });
  for (const re of NOTES) {
    s = s.replace(re, (m) => {
      notes.push(m.trim());
      return hold({ kind: "note", text: m.trim() });
    });
  }
  for (const [re, code] of PROGRAMS) {
    s = s.replace(re, (m, g1: string | undefined) => {
      const name = code === "$name" ? (g1 ?? m).trim() : code === "$1" ? String(g1) : code;
      return hold({ kind: "program", code: name, text: m.trim() });
    });
  }

  // "6 units of (COMP1100 or COMP1130)" / "6 units from COMP1100 or …" name
  // courses, not a count: keep only the group.
  s = s.replace(/\b\d+ units? (?:of|from)\s*:?\s*(?=\(|[A-Z]{4}\d{4}(?!-level))/g, " ");
  let out = "";
  let last = 0;
  for (const m of s.matchAll(UNITS_START)) {
    if (m.index! < last) continue;
    const rest = s.slice(m.index! + m[0].length);
    const clause = m[0] + rest.slice(0, unitsEnd(rest));
    out += s.slice(last, m.index) + hold(unitsClause(clause, Number(m[1])));
    last = m.index! + clause.length;
  }
  s = out + s.slice(last);

  s = s.replace(/\b([A-Z]{4})(\d{4})((?:\/(?:[A-Z]{4})?\d{4})+)/g, (_m, subject: string, first: string, more: string) => {
    const codes = [subject + first, ...more.split("/").filter(Boolean).map((c) => (c.length === 4 ? subject + c : c))];
    return hold({ kind: "any", of: codes.map((code) => ({ kind: "course", code })) });
  });

  // --- tokens --------------------------------------------------------------
  const tokens: Token[] = [];
  let oneOf = false;
  const push = (tok: Token) => {
    const prev = tokens.at(-1);
    const startsOperand = tok.t === "atom" || tok.t === "(" || tok.t === "conc";
    if (startsOperand && prev && (prev.t === "atom" || prev.t === ")")) {
      tokens.push(oneOf ? { t: "or", strong: false } : { t: "and" });
    }
    tokens.push(tok);
  };
  const lexer =
    /§C§|§(\d+)§|\b([A-Z]{4}\d{4})\b|(\()|(\))|([,;]?\s*\b(?:or|OR)\b)|((?:[,;]\s*)?\b(?:and|AND|including)\b(?!\/)|;)|\b((?:at least )?one of|any of|either)\b|(,)/g;
  let prevEnd = 0;
  for (const m of s.matchAll(lexer)) {
    const before = s.slice(prevEnd, m.index);
    const after = s.slice(m.index! + m[0].length);
    prevEnd = m.index! + m[0].length;
    if (m[0] === "§C§") push({ t: "conc" });
    else if (m[1] !== undefined) push({ t: "atom", req: held[Number(m[1])]! });
    else if (m[2]) push({ t: "atom", req: { kind: "course", code: m[2] } });
    else if (m[3]) push({ t: "(" });
    else if (m[4]) tokens.push({ t: ")" });
    else if (m[5]) {
      const strong =
        /^;/.test(m[5]) ||
        (before + m[5]).includes("\n") ||
        /^[ \t]*\n/.test(after) ||
        /^\s*(?:you must )?(?:have|be)\b/.test(after);
      if (strong) oneOf = false;
      tokens.push({ t: "or", strong });
    } else if (m[6]) {
      oneOf = false;
      tokens.push({ t: "and" });
    } else if (m[7]) oneOf = true;
    else if (m[8]) {
      // a list comma takes the connective that ends its list: "A, B or C"
      const inList = /^\s*(?:§\d+§|[A-Z]{4}\d{4})/.test(after);
      const next = inList ? /^[^.;\n()]*?\b(or|OR|and|AND)\b/.exec(after)?.[1]?.toLowerCase() : undefined;
      if (next === "or") tokens.push({ t: "or", strong: false });
      else if (next === "and") tokens.push({ t: "and" });
    }
  }

  // drop closing brackets that never opened (the texts have a few)
  let depth = 0;
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k]!.t === "(") depth++;
    else if (tokens[k]!.t === ")") {
      if (depth === 0) tokens.splice(k--, 1);
      else depth--;
    }
  }

  // --- parse: strongOr > and > or > atom -----------------------------------
  let i = 0;
  const peek = () => tokens[i];
  const skipOps = () => {
    while (peek() && (peek()!.t === "and" || peek()!.t === "or")) i++;
  };

  function expr(): Req | null {
    const alts = [andExpr()];
    while (peek()?.t === "or" && (peek() as { strong: boolean }).strong) {
      i++;
      alts.push(andExpr());
    }
    return combine("any", alts);
  }
  function andExpr(): Req | null {
    const parts = [orExpr()];
    while (peek()?.t === "and") {
      i++;
      parts.push(orExpr());
    }
    return combine("all", parts);
  }
  function orExpr(): Req | null {
    const parts = [unary()];
    while (peek()?.t === "or" && !(peek() as { strong: boolean }).strong) {
      i++;
      parts.push(unary());
    }
    return combine("any", parts);
  }
  function unary(): Req | null {
    skipOps();
    const tok = peek();
    if (!tok) return null;
    if (tok.t === "conc") {
      i++;
      const inner = orExpr();
      return inner && concurrent(inner);
    }
    if (tok.t === "(") {
      i++;
      const inner = expr();
      if (peek()?.t === ")") i++;
      return inner;
    }
    if (tok.t === ")") {
      i++; // stray closer
      return null;
    }
    i++;
    return (tok as { req: Req }).req;
  }

  let requires: Req | null = null;
  while (i < tokens.length) {
    const part = expr();
    requires = combine("all", [requires, part]);
    if (i < tokens.length && peek()?.t === ")") i++;
  }
  return { requires: requires && simplify(requires), notes };
}

function concurrent(req: Req): Req {
  if (req.kind === "course") return { ...req, concurrent: true };
  if (req.kind === "all" || req.kind === "any") return { ...req, of: req.of.map(concurrent) };
  return req;
}

function combine(kind: "all" | "any", parts: (Req | null)[]): Req | null {
  const of = parts.filter((p): p is Req => p !== null);
  if (of.length === 0) return null;
  return of.length === 1 ? of[0]! : { kind, of };
}

const key = (r: Req): string => JSON.stringify(r);

export function simplify(req: Req): Req {
  if (req.kind !== "all" && req.kind !== "any") return req;
  const flat: Req[] = [];
  for (const child of req.of.map(simplify)) {
    if (child.kind === req.kind) flat.push(...(child as { of: Req[] }).of);
    else flat.push(child);
  }
  const seen = new Set<string>();
  const of = flat.filter((r) => !seen.has(key(r)) && seen.add(key(r)));
  return of.length === 1 ? of[0]! : { kind: req.kind, of };
}

// --- checking -------------------------------------------------------------

export interface TakenCourse {
  code: string;
  units: number;
}

export interface RequisiteContext {
  done: TakenCourse[]; // completed before the semester being planned
  current: Set<string>; // planned in that semester (for "or currently enrolled")
  programs: string[]; // codes the student's program answers to, e.g. ["BCOMP", "SOFT-MAJ"]
}

const subjectOf = (code: string) => code.slice(0, 4);
const levelOf = (code: string) => Number(code[4]) * 1000;

export function unitsMatching(req: Extract<Req, { kind: "units" }>, done: TakenCourse[]): number {
  return done
    .filter(
      (c) =>
        (req.subjects.length === 0 || req.subjects.includes(subjectOf(c.code))) &&
        (req.levels.length === 0 || req.levels.includes(levelOf(c.code))) &&
        !req.exclude.includes(c.code),
    )
    .reduce((sum, c) => sum + c.units, 0);
}

export function meets(req: Req | null, ctx: RequisiteContext): boolean {
  if (!req) return true;
  switch (req.kind) {
    case "course":
      return ctx.done.some((c) => c.code === req.code) || (!!req.concurrent && ctx.current.has(req.code));
    case "all":
      return req.of.every((r) => meets(r, ctx));
    case "any":
      return req.of.some((r) => meets(r, ctx));
    case "units":
      return unitsMatching(req, ctx.done) >= req.units;
    case "program":
      return ctx.programs.includes(req.code);
    case "note":
      return true;
  }
}

// Every course a requirement names, and whether it's needed on every path
// ("required") or is one alternative among several.
export function courseLinks(req: Req | null): Map<string, "required" | "alternative"> {
  const links = new Map<string, "required" | "alternative">();
  const walk = (r: Req, required: boolean) => {
    if (r.kind === "course") {
      if (links.get(r.code) !== "required") links.set(r.code, required ? "required" : "alternative");
    } else if (r.kind === "all") for (const c of r.of) walk(c, required);
    else if (r.kind === "any") for (const c of r.of) walk(c, required && r.of.length === 1);
  };
  if (req) walk(req, true);
  return links;
}
