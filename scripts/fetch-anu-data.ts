// Refreshes src/lib/data/ from ANU Programs and Courses
// (programsandcourses.anu.edu.au). Run with `node scripts/fetch-anu-data.ts`.
//
// It fills the gaps the first scrape left:
// - offerings: which semesters each course runs, per year, from the site's
//   CourseSearch data endpoint (the same one the catalogue search page uses);
// - transdisciplinary: the "Transdisciplinary Problem-Solving" graduate
//   attribute tag, from the same endpoint's filter (BCOMP needs 12 units);
// - external-courses.json: every non-SoCo course a SoCo requisite, major,
//   specialisation or program list names, fetched from its course page;
// - soco-specialisations.json: the Master of Computing's specialisations. The
//   2027 program page doesn't link HCCM-SPEC or MCHL-SPEC, and MCHL-SPEC
//   only has a page up to the 2026 catalogue, so it comes from there;
// - tidies the majors' requirementsText (a stray HTML fragment) and gives
//   every MCOMP specialisation its code and URL.
import { readFileSync, writeFileSync } from "node:fs";

const DATA = new URL("../src/lib/data/", import.meta.url);
const SITE = "https://programsandcourses.anu.edu.au";
const CATALOGUE_YEAR = 2027;
const OFFERING_YEARS = [2026, 2027];
const TODAY = new Date().toISOString().slice(0, 10);

const read = (f: string) => JSON.parse(readFileSync(new URL(f, DATA), "utf8"));
const write = (f: string, v: unknown) => writeFileSync(new URL(f, DATA), `${JSON.stringify(v, null, 2)}\n`);

async function get(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (ANU course planner data refresh)" }, redirect: "manual" });
  return { status: res.status, body: res.status === 200 ? await res.text() : "" };
}

const text = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

const SESSION: Record<string, string> = {
  "First Semester": "S1",
  "Second Semester": "S2",
  "Summer Session": "Summer",
  "Autumn Session": "Autumn",
  "Winter Session": "Winter",
  "Spring Session": "Spring",
};

type SearchItem = { CourseCode: string; Name: string; Session: string; Career: string; Units: number };

async function search(year: number, extra = ""): Promise<SearchItem[]> {
  const url = `${SITE}/data/CourseSearch/GetCourses?ShowAll=true&SelectedYear=${year}&CollegeName=All+Colleges&ModeOfDelivery=All+Modes&PageSize=5000&MaxPageSize=5000${extra}`;
  const { body } = await get(url);
  return (JSON.parse(body).Items ?? []) as SearchItem[];
}

const codesIn = (s: string | null) => [...(s ?? "").matchAll(/\b([A-Z]{4}\d{4})\b(?!-level)/g)].map((m) => m[1]!);

// --- 1. Offerings and the TD tag, in bulk -----------------------------------
const offerings = new Map<string, Record<string, string[]>>();
const catalogue = new Map<string, SearchItem>();
for (const year of OFFERING_YEARS) {
  for (const item of await search(year)) {
    const sessions = item.Session.split("/").map((s) => SESSION[s.trim()]).filter((s): s is string => !!s);
    const entry = offerings.get(item.CourseCode) ?? {};
    entry[year] = sessions;
    offerings.set(item.CourseCode, entry);
    if (year === CATALOGUE_YEAR || !catalogue.has(item.CourseCode)) catalogue.set(item.CourseCode, item);
  }
}
const td = new Set(
  (await search(CATALOGUE_YEAR, "&GraduateAttributes=Transdisciplinary+Problem-Solving")).map((i) => i.CourseCode),
);
// The endpoint ignores a filter it doesn't recognise and returns everything.
if (td.size > catalogue.size / 4) throw new Error(`TD filter returned ${td.size} courses — filter ignored?`);
console.log(`catalogue: ${catalogue.size} courses, ${td.size} tagged Transdisciplinary`);

const withOfferings = <T extends { code: string }>(c: T) => ({
  ...c,
  offerings: offerings.get(c.code) ?? {},
  transdisciplinary: td.has(c.code),
});

// --- 2. Specialisations (Master of Computing) --------------------------------
const programs = read("soco-programs.json");
const mcomp = programs.programs.find((p: { code: string }) => p.code === "7706XMCOMP");
const specPage = async (code: string) => {
  for (const year of [CATALOGUE_YEAR, 2026]) {
    const page = await get(`${SITE}/${year}/specialisation/${code}`);
    if (page.status === 200) return { year, body: page.body };
  }
  throw new Error(`no page for ${code}`);
};
// Codes from the 2026 program page, which still links all seven.
const SPEC_CODES: Record<string, string> = {
  "Artificial Intelligence": "ARTIF-SPEC",
  "Computational Foundations": "COMP-SPEC",
  "Computer Systems": "CMSY-SPEC",
  "Data Science": "DTSC-SPEC",
  "Human Centred and Creative Computing": "HCCM-SPEC",
  "Machine Learning": "MCHL-SPEC",
  "Software Development": "SOFT-SPEC",
};
const specialisations = [];
for (const spec of mcomp.specialisations) {
  const code = SPEC_CODES[spec.name]!;
  const { year, body } = await specPage(code);
  const start = body.indexOf('id="requirements"');
  const end = body.indexOf("Back to the top", start);
  const requirementsText = text(body.slice(body.indexOf(">", start) + 1, end)).replace(/^Requirements\n/, "");
  // the page title carries the full name: "Machine Learning Specialisation - ANU"
  const title = /<title>([^<]*?)(?: - ANU)?\s*<\/title>/.exec(body)?.[1];
  const url = `${SITE}/${year}/specialisation/${code}`;
  spec.code = code;
  spec.url = url;
  specialisations.push({
    code,
    title: title ? text(title) : `${spec.name} Specialisation`,
    url,
    catalogueYear: year,
    minUnits: Number(/(\d+) units/.exec(requirementsText)?.[1] ?? 24),
    courseCodes: [...new Set(codesIn(requirementsText))],
    requirementsText,
  });
}
write("soco-specialisations.json", {
  _source: `ANU Programs and Courses — specialisation pages linked from the Master of Computing (${SITE}/2026/program/7706XMCOMP).`,
  _note: `The 2027 program page links only some of its seven specialisations; the rest come from the 2026 catalogue (${specialisations
    .filter((s) => s.catalogueYear !== CATALOGUE_YEAR)
    .map((s) => s.code)
    .join(", ")}). catalogueYear says which year each page came from.`,
  _fetchedOn: TODAY,
  specialisations,
});
programs._fetchedOn = TODAY;
write("soco-programs.json", programs);

// --- 3. Majors: tidy the scraped text ----------------------------------------
const majors = read("soco-majors.json");
for (const m of majors.majors) m.requirementsText = m.requirementsText.replace(/^id="requirements">Requirements\n/, "");
write("soco-majors.json", majors);

// --- 4. SoCo courses: add offerings + TD --------------------------------------
const soco = read("soco-courses.json");
soco.courses = soco.courses.map(withOfferings);
soco._offeringsSource = `${SITE}/data/CourseSearch/GetCourses (years ${OFFERING_YEARS.join(", ")}); 'offerings' maps year → sessions (S1, S2, Summer, Autumn, Winter, Spring). 'transdisciplinary' is the Transdisciplinary Problem-Solving graduate attribute filter.`;
soco._fetchedOn = TODAY;
write("soco-courses.json", soco);

// --- 5. External courses: everything named but not offered by SoCo -----------
const have = new Set<string>(soco.courses.map((c: { code: string }) => c.code));
const wanted = new Set<string>();
for (const c of soco.courses) for (const code of codesIn(c.requisiteText)) wanted.add(code);
for (const m of majors.majors) for (const code of codesIn(m.requirementsText)) wanted.add(code);
for (const s of specialisations) for (const code of s.courseCodes) wanted.add(code);
for (const p of programs.programs) for (const code of codesIn(p.requirementsText)) wanted.add(code);

const external = [];
const missing = [];
for (const code of [...wanted].sort()) {
  if (have.has(code)) continue;
  let page = await get(`${SITE}/${CATALOGUE_YEAR}/course/${code}`);
  let year = CATALOGUE_YEAR;
  if (page.status !== 200) {
    page = await get(`${SITE}/2026/course/${code}`);
    year = 2026;
  }
  if (page.status !== 200) {
    missing.push(code);
    continue;
  }
  const b = page.body;
  const field = (label: string) =>
    new RegExp(`${label}</span>\\s*<span class="degree-summary__code-text">([^<]*)<`).exec(b)?.[1]?.trim() ?? null;
  const requisite = /<div class="requisite">([\s\S]*?)<\/div>/.exec(b)?.[1] ?? "";
  const requisiteText = text(requisite);
  const title = text(/<span class="intro__degree-title__component">([\s\S]*?)<\/span>/.exec(b)?.[1] ?? "");
  const units = Number(/Unit Value<\/span>\s*([\d.]+) units/.exec(b)?.[1] ?? catalogue.get(code)?.Units ?? 6);
  const career = field("Academic career");
  external.push(
    withOfferings({
      code,
      title,
      level: career === "PGRD" ? "postgraduate" : "undergraduate",
      units,
      subjectArea: field("Course subject"),
      offeredBy: field("Offered by"),
      catalogueYear: year,
      hasPrerequisite: /must have|completed|enrolled/i.test(requisiteText),
      incompatibleWith: codesIn(requisiteText.split(/incompatible|not able to enrol/i)[1] ?? ""),
      requisiteText,
    }),
  );
  console.log(`  ${code} ${title} (${year})`);
}
write("external-courses.json", {
  _source: `ANU Programs and Courses course pages (${SITE}/<year>/course/<code>), for courses outside the School of Computing that SoCo requisites, majors, specialisations or program rules name. Offerings and the TD tag as in soco-courses.json.`,
  _note: `catalogueYear is ${CATALOGUE_YEAR} where the course is in that catalogue, else 2026. Codes named in requisites but absent from both catalogues: ${missing.join(", ") || "none"}.`,
  _fetchedOn: TODAY,
  courses: external,
});
console.log(`external: ${external.length} fetched; not in catalogue: ${missing.join(", ") || "none"}`);
