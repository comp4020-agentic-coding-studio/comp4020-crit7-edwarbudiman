import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";

// Contracts of the rail's two drawers, the semester plan's skill tree, and
// the account. They don't hardcode which semester is current (that moves
// with the date); they read it from the planner drawer. The account starts
// with the demo history (src/lib/demo.ts): COMP1100 … COMP2700 in three
// submitted semesters before 2026-S2.
const baseUrl = inject("baseUrl");

const post = (path: string, fields: Record<string, string>) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    redirect: "manual",
    headers: { Origin: new URL(baseUrl).origin },
    body: new URLSearchParams(fields),
  });

async function page(path = "/") {
  const res = await fetch(new URL(path, baseUrl));
  return new JSDOM(await res.text()).window.document;
}

// Replace a semester's enrolment: back to a draft, add each course, submit.
async function enrol(semester: string, codes: string[]) {
  await post("/api/plan", { semester, action: "reopen" });
  for (const code of codes) await post("/api/plan", { semester, code });
  return post("/api/plan", { semester, action: "submit" });
}

function currentPlanHref(doc: Document) {
  const link = doc.querySelector<HTMLAnchorElement>("#drawer-planner .drawer-list a");
  expect(link, "planner drawer links the current semester's plan").toBeTruthy();
  return link!.getAttribute("href")!;
}

describe("Course Planner drawer", () => {
  it("lists previous semesters latest first, each with its dates", async () => {
    const doc = await page();
    const headings = [...doc.querySelectorAll("#drawer-planner h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Plan for current semester", "Plans for previous semesters"]);

    const previous = [...doc.querySelectorAll("#drawer-planner .drawer-list")][1];
    const items = [...(previous?.querySelectorAll("li") ?? [])];
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expect(li.textContent).toMatch(/\d{4} – \d{1,2} \w{3,4} \d{4}/);

    const ids = items.map((li) => li.querySelector("a")!.getAttribute("href")!);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});

describe("Current Courses drawer", () => {
  it("asks for a first course while the current semester's plan is empty", async () => {
    const doc = await page();
    expect(doc.querySelector("#drawer-current")?.textContent).toContain(
      "You need to choose your first courses",
    );
  });

  it("shows a course once the semester's selection is submitted, and it survives a reload", async () => {
    const semester = currentPlanHref(await page()).split("/")[2]!;
    const res = await post("/api/plan", { semester, code: "COMP2120" });
    expect(res.status).toBe(303);
    // selected isn't enrolled
    expect((await page()).querySelector("#drawer-current")?.textContent).toContain("1 selected, not submitted yet");

    expect((await post("/api/plan", { semester, action: "submit" })).status).toBe(303);
    for (const path of ["/", `/plan/${semester}/`]) {
      const drawer = (await page(path)).querySelector("#drawer-current")!;
      expect(drawer.textContent).toContain("Software Engineering");
      expect(drawer.textContent).not.toContain("You need to choose your first courses");
    }
  });
});

describe("course view", () => {
  it("has the hamburger and Canvas section menu only inside a course", async () => {
    for (const path of ["/", "/readme/"]) {
      const doc = await page(path);
      expect(doc.querySelector(".nav-toggle"), `no hamburger on ${path}`).toBeNull();
      expect(doc.querySelector("#course-nav"), `no course menu on ${path}`).toBeNull();
    }

    const semester = currentPlanHref(await page()).split("/")[2]!;
    await enrol(semester, ["COMP2120", "COMP2310"]);
    const link = [...(await page()).querySelectorAll<HTMLAnchorElement>("#drawer-current a")].find(
      (a) => a.textContent === "Systems, Networks, and Concurrency",
    );
    expect(link, "Current Courses links the course").toBeTruthy();

    const doc = await page(link!.getAttribute("href")!);
    expect(doc.querySelector(".nav-toggle")?.getAttribute("aria-controls")).toBe("course-nav");
    const sections = [...doc.querySelectorAll("#course-nav a")].map((a) => a.textContent);
    expect(sections[0]).toBe("Home");
    expect(sections).toEqual(expect.arrayContaining(["Modules", "Assignments", "Marks", "People"]));
    expect(doc.querySelectorAll("h1")).toHaveLength(1);

    for (const a of doc.querySelectorAll<HTMLAnchorElement>("#course-nav a")) {
      const res = await fetch(new URL(a.getAttribute("href")!, baseUrl));
      expect(res.status, a.getAttribute("href")!).toBe(200);
    }
  });
});

const tileCodes = (doc: Document) => [...doc.querySelectorAll<HTMLElement>(".tile[data-code]")].map((t) => t.dataset.code);
const tile = (doc: Document, code: string) => doc.querySelector<HTMLElement>(`.tile[data-code="${code}"]`);

describe("semester plan", () => {
  it("has its own section menu, and asks for the program first", async () => {
    const overview = currentPlanHref(await page());
    const doc = await page(overview);
    expect(doc.querySelector(".nav-toggle")?.getAttribute("aria-controls")).toBe("course-nav");
    const items = [...doc.querySelectorAll<HTMLAnchorElement>("#course-nav a")];
    expect(items.map((a) => a.textContent)).toEqual(["Overview", "Add Course"]);

    expect(doc.querySelector(".plan-steps .step.is-active")?.textContent).toContain("Program");
    expect(doc.querySelector(".skill-tree")).toBeNull();
    const programs = [...doc.querySelectorAll<HTMLInputElement>(".choice-card input[name=program]")].map((i) => i.value);
    expect(programs).toEqual(["BCOMP", "7706XMCOMP"]);
  });

  it("remembers the program on the server, with no major to choose", async () => {
    const overview = currentPlanHref(await page());
    const res = await post("/api/profile", { program: "BCOMP", back: overview });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(overview);

    const doc = await page(overview);
    expect(doc.querySelector(".skill-tree"), "straight to the tree").toBeTruthy();
    expect(doc.querySelector(".plan-steps")?.textContent).toContain("Bachelor of Computing");
    expect(doc.querySelector(".plan-steps .step.is-active")?.textContent).toContain("Courses for");
    expect((await page("/profile/")).querySelector("main")?.textContent).toContain("Bachelor of Computing");
  });

  it("shows the same tree in Overview and Add Course", async () => {
    const overview = currentPlanHref(await page());
    const a = tileCodes(await page(overview));
    const b = tileCodes(await page(`${overview}add/`));
    expect(a.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
    // Overview pairs it with the requirements, Add Course with the selection
    expect((await page(overview)).querySelector(".tracker")).toBeTruthy();
    expect((await page(`${overview}add/`)).querySelector(".selection")).toBeTruthy();
  });

  it("gives each tile a state: done, enrolled, open, next, locked, excluded", async () => {
    const add = `${currentPlanHref(await page())}add/`;
    const doc = await page(add);
    const state = (code: string) => tile(doc, code)?.closest(".tile-cell")?.querySelector(".tile-state")?.textContent;
    expect(state("COMP1100")).toBe("Done");
    expect(state("COMP2120")).toBe("Enrolled");
    // needs COMP2120 completed; taking it now opens it next semester
    expect(state("COMP4130")).toBe("Next");
    const all = await page(`${add}?tab=all`);
    const stateAll = (code: string) => tile(all, code)?.closest(".tile-cell")?.querySelector(".tile-state")?.textContent;
    // every course runs every semester: only prerequisites close one
    expect(stateAll("COMP3600")).toBe("Open");
    expect(stateAll("COMP4600")).toBe("Locked");
    expect(stateAll("COMP1130")).toBe("Excluded"); // incompatible with COMP1100
  });

  it("starts a new student in their first semester, with nothing before it", async () => {
    await post("/api/profile", { reset: "fresh" });
    const doc = await page();
    const previous = [...doc.querySelectorAll("#drawer-planner h3")].find((h) => h.textContent === "Plans for previous semesters");
    expect(previous?.nextElementSibling?.textContent).toContain("No previous semesters");
    const overview = currentPlanHref(doc);
    await post("/api/profile", { program: "BCOMP", back: overview });
    expect(tileCodes(await page(overview)).length).toBeGreaterThan(5);
    expect((await page(overview)).querySelectorAll(".tile.is-done")).toHaveLength(0);
  });

  it("marks what the program still needs", async () => {
    const overview = currentPlanHref(await page());
    const doc = await page(`${overview}add/`);
    const state = (code: string) => tile(doc, code)?.closest(".tile-cell")?.querySelector(".tile-state")?.textContent;
    expect(state("COMP1100")).toBe("Needed · open");
    expect(state("COMP2100")).toBe("Needed · locked");

    // selecting COMP1100 turns what it unlocks into "next"
    await post("/api/plan", { semester: overview.split("/")[2]!, code: "COMP1100" });
    const after = await page(`${overview}add/`);
    const stateAfter = (code: string) => tile(after, code)?.closest(".tile-cell")?.querySelector(".tile-state")?.textContent;
    expect(stateAfter("COMP1100")).toBe("Selected");
    expect(stateAfter("COMP1110")).toBe("Needed · next");
    // and COMP1130 is no longer needed: it's excluded by COMP1100
    expect(tile(after, "COMP1130") === null, "COMP1130 off the path").toBe(true);
  });

  it("adds from a course's detail into the selection, then submits and opens the next semester", async () => {
    const add = `${currentPlanHref(await page())}add/`;
    const semester = add.split("/")[2]!;
    // the Add button is in the detail, not on the tiles
    expect((await page(add)).querySelector(".tile-cell form")).toBeNull();
    const form = (await page(`${add}?course=MATH1005`)).querySelector<HTMLFormElement>("#course-detail form")!;
    expect(form.querySelector("button")?.textContent).toContain("Add to this semester");
    const fields: Record<string, string> = {};
    for (const input of form.querySelectorAll<HTMLInputElement>("input")) fields[input.name] = input.value;
    const res = await post(form.getAttribute("action")!, fields);
    expect(res.status).toBe(303);

    const picked = await page(res.headers.get("location")!);
    const slots = [...picked.querySelectorAll(".selection .slot.filled")].map((s) => s.querySelector("strong")?.textContent);
    expect(slots).toEqual(["COMP1100", "MATH1005"]);
    expect(picked.querySelectorAll(".selection .slot.empty")).toHaveLength(2);
    expect(picked.querySelector(".next-semester"), "nothing next until submitted").toBeNull();

    const submitted = await post("/api/plan", { semester, action: "submit" });
    const done = await page(submitted.headers.get("location")!);
    expect(done.querySelector(".selection")?.textContent).toContain("Submitted");
    const next = done.querySelector<HTMLAnchorElement>(".next-semester a")!;
    expect(next.textContent).toContain("Plan");

    // next semester: what was enrolled is done, so more opens up
    const nextDoc = await page(next.getAttribute("href")!);
    const state = (code: string) => tile(nextDoc, code)?.closest(".tile-cell")?.querySelector(".tile-state")?.textContent;
    expect(state("COMP1100")).toBe("Done");
    expect(state("COMP1110")).toBe("Needed · open");
    expect((await page()).querySelector("#drawer-planner")?.textContent).toContain("Plan ahead");
  });

  it("keeps each tier in course-code order, so a tile doesn't move when it's selected", async () => {
    const add = `${currentPlanHref(await page())}add/`;
    for (const tab of ["program", "all"]) {
      const doc = await page(`${add}?tab=${tab}`);
      for (const tier of doc.querySelectorAll(".tier")) {
        const codes = [...tier.querySelectorAll<HTMLElement>(".tile[data-code]")].map((t) => t.dataset.code!);
        expect(codes, `${tab}: ${tier.querySelector("h3")?.textContent}`).toEqual([...codes].sort());
      }
    }
  });

  it("shows a course's prerequisites as ticked AND / OR groups", async () => {
    const add = `${currentPlanHref(await page())}add/`;
    const detail = (await page(`${add}?course=COMP2310`)).querySelector("#course-detail")!;
    const joins = [...detail.querySelectorAll(".req-join")].map((j) => j.textContent?.replace(/\s+/g, " ").trim());
    expect(joins[0]).toContain("All of");
    expect(joins.filter((j) => j?.includes("One of"))).toHaveLength(2);
  });

  it("closes a course's detail back to the same view, nothing selected", async () => {
    const add = `${currentPlanHref(await page())}add/`;
    const close = (await page(`${add}?tab=all&course=COMP2310`)).querySelector<HTMLAnchorElement>("#course-detail .detail-close")!;
    const href = new URL(close.getAttribute("href")!, baseUrl);
    expect(href.pathname).toBe(add);
    expect(href.searchParams.get("tab")).toBe("all");
    expect(href.searchParams.has("course")).toBe(false);
    expect((await page(href.pathname + href.search)).querySelector("#course-detail")).toBeNull();
  });

  it("won't add a locked course, even posted directly", async () => {
    const add = `${currentPlanHref(await page())}add/`;
    const detail = (await page(`${add}?course=COMP4130`)).querySelector("#course-detail")!;
    expect(detail.querySelector("form")).toBeNull();
    expect(detail.querySelector(".detail-why")).toBeTruthy();

    const semester = add.split("/")[2]!;
    const res = await post("/api/plan", { semester, code: "COMP4130" });
    expect(res.headers.get("location")).toContain("refused=COMP4130");
    expect((await page(add)).querySelector(".selection")?.textContent).not.toContain("COMP4130");
  });
});

describe("majors tab", () => {
  it("shows every major's progress without choosing one, and each one's courses", async () => {
    await post("/api/profile", { reset: "history" });
    const overview = currentPlanHref(await page());
    await post("/api/profile", { program: "BCOMP", back: overview });
    const doc = await page(`${overview}?tab=majors`);
    const cards = [...doc.querySelectorAll(".major-card")];
    expect(cards).toHaveLength(7);
    // closest first, and it's the one open
    expect(cards[0]?.getAttribute("aria-current")).toBe("true");

    const soft = await page(`${overview}?tab=majors&major=SOFT-MAJ`);
    expect(soft.querySelector('.major-card[aria-current]')?.textContent).toContain("Software Development");
    expect(tile(soft, "COMP3500")?.querySelector(".role-stream")).toBeTruthy();
    expect(tile(soft, "COMP2120")?.closest(".tile-cell")?.querySelector(".tile-state")?.textContent).toBe("Needed · open");
    // the program path doesn't carry major markers
    expect((await page(overview)).querySelector(".role-stream")).toBeNull();
  });

  it("says in words how to complete the major being looked at, each rule ticked", async () => {
    const overview = currentPlanHref(await page());
    const guide = (await page(`${overview}?tab=majors&major=SOFT-MAJ`)).querySelector(".major-guide")!;
    expect(guide.querySelector("h3")?.textContent).toBe("How to complete the Software Development Major");
    // each line: a ✓ / ✗ mark, then the rule in words
    const lines = [...guide.querySelectorAll(".major-guide-rules li")].map((li) => li.children[1]?.textContent?.replace(/\s+/g, " ").trim());
    expect(lines[0]).toMatch(/^Take all of: COMP2120, COMP3500 and COMP4130/);
    expect(lines.some((l) => l?.startsWith("At least 12 units from: COMP3600, COMP3610"))).toBe(true);
    expect(lines.some((l) => l?.includes("at 3000/4000-level") && l.includes("so far"))).toBe(true);
    expect(guide.querySelector(".req-mark")).toBeTruthy();
  });

  it("lists every major a course counts toward", async () => {
    const overview = currentPlanHref(await page());
    const facts = (await page(`${overview}?course=COMP2120`)).querySelector("#course-detail .facts")?.textContent ?? "";
    for (const major of ["Cyber Security", "Software Development", "Information Systems"]) expect(facts).toContain(major);
  });
});

describe("Master of Computing", () => {
  it("plans against its postgraduate courses, with its specialisations in their own tab", async () => {
    const overview = currentPlanHref(await page());
    await post("/api/profile", { program: "7706XMCOMP", back: overview });
    const doc = await page(overview);
    const tiers = [...doc.querySelectorAll(".tier-head h3")].map((h) => h.textContent);
    expect(tiers).toEqual(expect.arrayContaining(["6000-level", "8000-level"]));
    expect([...doc.querySelectorAll(".tree-tabs a")].map((a) => a.textContent)).toContain("Specialisations");

    const ml = await page(`${overview}?tab=majors&major=MCHL-SPEC`);
    expect(ml.querySelectorAll(".major-card")).toHaveLength(7);
    // needs only Master of Computing enrolment
    expect(tile(ml, "COMP6528")?.classList).toContain("is-open");
  });
});

describe("requirements checklist", () => {
  const lines = (doc: Document, list: string) =>
    [...doc.querySelectorAll(`${list} > .check`)].map((li) => li.querySelector(".check-line")?.textContent?.replace(/\s+/g, " ").trim() ?? "");

  it("lists what's left to finish, named courses first, with met ones folded away", async () => {
    await post("/api/profile", { reset: "fresh" });
    const overview = currentPlanHref(await page());
    await post("/api/profile", { program: "7706XMCOMP", back: overview });
    const doc = await page(overview);
    const left = lines(doc, ".tracker > .checklist");
    expect(left[0]).toMatch(/^Take all of COMP6120, COMP6442, COMP7710 and COMP8280/);
    expect(left[1]).toMatch(/^Foundations — pick 1: MATH6005 or COMP6260/);
    expect(left.at(-1)).toMatch(/^Total: 96 units — 0 so far/);
    // codes open the course's detail
    const link = doc.querySelector<HTMLAnchorElement>(".tracker .check-line a")!;
    expect(new URL(link.href, baseUrl).searchParams.get("course")).toBe("COMP6120");
    // "up to" rules have nothing missing: they're with the met ones
    expect(lines(doc, ".tracker-met .checklist").some((l) => l.startsWith("Project courses: up to 12 units"))).toBe(true);
  });

  it("half-ticks a course selected this semester until it's submitted", async () => {
    const overview = currentPlanHref(await page());
    const semester = overview.split("/")[2]!;
    await post("/api/plan", { semester, code: "COMP6260" });
    const foundations = [...(await page(overview)).querySelectorAll(".tracker .check")].find((li) => li.textContent?.includes("Foundations"))!;
    expect(foundations.classList).toContain("is-planned");
    expect(foundations.querySelector(".check-mark")?.textContent).toBe("◐");
    await post("/api/plan", { semester, action: "submit" });
    const met = (await page(overview)).querySelector(".tracker-met")!;
    expect(met.textContent).toContain("Foundations");
  });
});

describe("the end of a program", () => {
  // Pick the first open course of a semester (by code), `n` times — one at a
  // time, since a pick can exclude another — and submit.
  async function enrolOpen(semester: string, n = 4) {
    const picked: string[] = [];
    for (let i = 0; i < n; i++) {
      const code = (await page(`/plan/${semester}/add/?tab=all`)).querySelector<HTMLElement>(".tile.is-open")?.dataset.code;
      if (!code) break;
      await post("/api/plan", { semester, code });
      picked.push(code);
    }
    await post("/api/plan", { semester, action: "submit" });
    return picked;
  }

  it("stops at the program's units: no semester after the last, nothing more to add", async () => {
    await post("/api/profile", { reset: "fresh" });
    const first = currentPlanHref(await page());
    await post("/api/profile", { program: "7706XMCOMP", back: first });
    // MCOMP is 96 units: four full semesters
    let semester = first.split("/")[2]!;
    for (let i = 0; i < 3; i++) {
      expect(await enrolOpen(semester)).toHaveLength(4);
      const next = (await page(`/plan/${semester}/add/`)).querySelector<HTMLAnchorElement>(".next-semester a");
      expect(next, `a semester after ${semester}`).toBeTruthy();
      semester = next!.getAttribute("href")!.split("/")[2]!;
    }
    // 72 done, so the last semester has four slots and ends the program
    expect(await enrolOpen(semester)).toHaveLength(4);
    const last = await page(`/plan/${semester}/add/`);
    expect(last.querySelector(".next-semester a"), "no semester after the last").toBeNull();
    expect(last.body.textContent).toContain("That's the whole program");
    // the semester after the last (by id: 2028-S1 → 2028-S2 → 2029-S1)
    const [year, half] = semester.split("-S").map(Number) as [number, number];
    const beyond = half === 1 ? `${year}-S2` : `${year + 1}-S1`;
    const label = (id: string) => `${id.endsWith("S1") ? "First" : "Second"} Semester, ${id.slice(0, 4)}`;
    const drawer = (await page()).querySelector("#drawer-planner")!.textContent ?? "";
    expect(drawer).toContain(label(semester));
    expect(drawer, "the drawer stops at the last semester").not.toContain(label(beyond));

    // and takes nothing
    const res = await post("/api/plan", { semester: beyond, code: "COMP6120" });
    expect(res.headers.get("location")).toContain("refused=COMP6120");
    expect((await page(`/plan/${beyond}/add/`)).body.textContent).toContain("Program complete");
  });

  it("gives the last semester only the units the program has left", async () => {
    await post("/api/profile", { reset: "fresh" });
    const first = currentPlanHref(await page());
    await post("/api/profile", { program: "7706XMCOMP", back: first });
    let semester = first.split("/")[2]!;
    // 4 + 4 + 4 + 3 courses = 90 units, so the fifth semester has one slot
    for (const n of [4, 4, 4, 3]) {
      await enrolOpen(semester, n);
      semester = (await page(`/plan/${semester}/add/`)).querySelector(".next-semester a")!.getAttribute("href")!.split("/")[2]!;
    }
    const doc = await page(`/plan/${semester}/add/`);
    expect(doc.querySelectorAll(".selection .slot")).toHaveLength(1);
    expect(doc.querySelector(".selection-count")?.textContent).toContain("0 of 6 units");
  });
});

describe("demo account", () => {
  it("starts over with the demo history and no program", async () => {
    const res = await post("/api/profile", { reset: "history" });
    expect(res.status).toBe(303);
    const doc = await page(currentPlanHref(await page()));
    expect(doc.querySelector(".choice-card")).toBeTruthy();
    expect(doc.querySelector("#drawer-current")?.textContent).toContain("You need to choose your first courses");
    const s1 = [...doc.querySelectorAll("#drawer-planner li")].find((li) => li.textContent?.includes("First Semester, 2026"));
    expect(s1?.textContent).toContain("4 courses");
  });

  it("or as a new student with no courses and no earlier semesters", async () => {
    await post("/api/profile", { reset: "fresh" });
    const doc = await page();
    expect(doc.querySelector("#drawer-planner")?.textContent).not.toContain("First Semester, 2026");
    expect(doc.querySelector("#drawer-planner")?.textContent).toContain("No previous semesters");
  });
});
