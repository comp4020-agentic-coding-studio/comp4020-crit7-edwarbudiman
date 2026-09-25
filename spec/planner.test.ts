import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";

// Contracts of the rail's two drawers: Current Courses and Course Planner.
// They don't hardcode which semester is current (that moves with the date);
// they read it from the planner drawer.
const baseUrl = inject("baseUrl");

async function page(path = "/") {
  const res = await fetch(new URL(path, baseUrl));
  return new JSDOM(await res.text()).window.document;
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

  it("shows a course once it is planned for the current semester, and it survives a reload", async () => {
    const semester = currentPlanHref(await page()).split("/")[2]!;
    const res = await fetch(new URL("/api/plan", baseUrl), {
      method: "POST",
      redirect: "manual",
      headers: { Origin: new URL(baseUrl).origin },
      body: new URLSearchParams({ semester, code: "COMP1100", title: "Programming as Problem Solving" }),
    });
    expect(res.status).toBe(303);

    for (const path of ["/", `/plan/${semester}/`]) {
      const drawer = (await page(path)).querySelector("#drawer-current")!;
      expect(drawer.textContent).toContain("Programming as Problem Solving");
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
    await fetch(new URL("/api/plan", baseUrl), {
      method: "POST",
      redirect: "manual",
      headers: { Origin: new URL(baseUrl).origin },
      body: new URLSearchParams({ semester, code: "COMP2100", title: "Software Design Methodologies" }),
    });
    const link = [...(await page()).querySelectorAll<HTMLAnchorElement>("#drawer-current a")].find(
      (a) => a.textContent === "Software Design Methodologies",
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

describe("semester plan", () => {
  it("has its own section menu, and Add Course puts a course in the plan", async () => {
    const overview = currentPlanHref(await page());
    const doc = await page(overview);
    expect(doc.querySelector(".nav-toggle")?.getAttribute("aria-controls")).toBe("course-nav");
    const items = [...doc.querySelectorAll<HTMLAnchorElement>("#course-nav a")];
    expect(items.map((a) => a.textContent)).toEqual(["Overview", "Add Course"]);

    const addHref = items[1]!.getAttribute("href")!;
    const add = await page(addHref);
    const form = add.querySelector<HTMLFormElement>("form.add-course")!;
    const fields = new URLSearchParams();
    for (const input of form.querySelectorAll<HTMLInputElement>("input")) {
      fields.set(input.name, input.type === "hidden" ? input.value : "");
    }
    fields.set("code", "math1013");
    fields.set("title", "Mathematics and Applications 1");

    const res = await fetch(new URL(form.getAttribute("action")!, baseUrl), {
      method: "POST",
      redirect: "manual",
      headers: { Origin: new URL(baseUrl).origin },
      body: fields,
    });
    expect(res.status).toBe(303);
    const after = await page(res.headers.get("location")!);
    expect(after.querySelector("[role=status]")?.textContent).toContain("MATH1013");
    expect(after.querySelector(".plan-list")?.textContent).toContain("Mathematics and Applications 1");
  });
});
