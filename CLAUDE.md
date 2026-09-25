# ANU Course Planner (COMP4020 crit 7)

Crit 7 brief: pick an ANU system you actually deal with and build the
full-stack replacement you wish existed — model the slice that annoys you,
wire it end to end, persist it in SQLite, ship it to Fly. Spec lines are on the
course site (`/api/crits/07-anu-system.json`).

## What we're building

A re-creation of how an ANU student chooses courses each semester, dressed as
ANU Canvas so it feels like part of the system students already use. The
end goal: use public ANU data to model what courses exist and what their
prerequisites are, then plan semesters against that. The course data and the
choosing logic are **not built yet** — the layout came first, and the planner
logic will be designed with the user in a later session.

## The layout (done)

Built to match canvas.anu.edu.au (colours, sizes, Lato, measured from the live
site — `src/styles.css` tokens):

- **Global rail** (black, left, `src/components/GlobalNav.astro`) with three
  items only:
  1. **Dashboard** — link to `/`, an empty placeholder for now.
  2. **Current Courses** — a Canvas-style drawer. Always shows the *current*
     semester. Empty → "You need to choose your first courses for this
     semester."; otherwise lists that semester's courses, each linking to its
     course page.
  3. **Course Planner** — a drawer with "Plan for current semester" and "Plans
     for previous semesters", latest first, each showing the semester's dates.
- **Crumb header** + one content column (`src/layouts/CanvasLayout.astro`).
- **Hamburger + section menu** appear only on pages that have sections of
  their own (pass `sections` to the layout). Currently:
  - a course (`/courses/<id>/…`): Home, Modules, Ed Discussion, Class
    Recordings, Readings, Assignments, Marks, People, Notebook — the sections
    most ANU Canvas courses share. Only Home has content.
  - a semester plan (`/plan/<semester>/…`): **Overview** (deliberately blank —
    the user will design it) and **Add Course** (form + list with remove).
  Dashboard and About never get a hamburger.

## Data

- `semesters` — reference data seeded by migration, dates from the ANU
  university calendar (first teaching day → last exam day). Current semester =
  latest one that has started (`src/lib/plans.ts`).
- `planned_courses` — a course code + title in a semester's plan. Written only
  via `POST /api/plan` from the Add Course section.
- The starter's guestbook UI is gone; `/api/events` (SSE) stays because the
  deploy workflow checks it.

## Rules

- The user reviews visual/design changes themselves. Don't screenshot or
  browse-check the app to judge the design unless asked; say where to look.
- Don't fill in areas the user has said they'll design (plan Overview, the
  planner logic, Dashboard) — leave them blank until asked.
- Keep the Canvas look: new UI reuses the existing tokens and patterns (rail,
  drawers, section menu) rather than inventing new chrome.
- Real ANU data only — semester dates and course/prerequisite data come from
  public ANU sources, cited in a comment where they're loaded. No invented
  course records presented as real.
- Schema changes go through `src/lib/schema.ts` + `pnpm db:generate`; never
  hand-edit the database.
- New pages get added to `spec/routes.ts`. Contracts the user asks for get a
  test in `spec/planner.test.ts`. `pnpm check` must be green before saying a
  change is done.
