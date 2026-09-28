# ANU Course Planner (COMP4020 crit 7)

Crit 7 brief: pick an ANU system you actually deal with and build the
full-stack replacement you wish existed — model the slice that annoys you,
wire it end to end, persist it in SQLite, ship it to Fly. Spec lines are on the
course site (`/api/crits/07-anu-system.json`).

## What we're building

A re-creation of how an ANU student chooses courses each semester, dressed as
ANU Canvas so it feels like part of the system students already use. The
end goal: use public ANU data to model what courses exist and what their
prerequisites are, then plan semesters against that. Courses are chosen on a
**skill tree** (like a game's): square course tiles in tiers by level, each
with a state in words — Done, Selected/Enrolled, Needed · open, Open, Next
(unlocked by this semester's picks), Needed · locked, Locked, Excluded —
prerequisites traced as lines. Tiles in a tier sit in course-code order and
never move when their state changes. "Needed" = on a program (or viewed major's)
rule that isn't filled yet. Every course is treated as running every
semester: only prerequisites (or an incompatible course) close one — the user
asked for this, don't reintroduce timetable offerings.

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
  - a semester plan (`/plan/<semester>/…`): steps **1 Program → 2 Courses**
    (program chosen once, on cards; `?change=program` reopens). Then
    **Overview** (skill tree + Requirements checklist: what's left, named
    courses first, closest major nested, met ones folded; ◐ = selected, not
    submitted) and **Add Course**: a
    brief intro (program requirements, what majors are, how to pick), the
    selection (4 slots, **Submit**), and the tree — click a tile, then "Add to
    this semester" in its detail. Picks are a draft until submitted; once
    submitted, "Add courses to next semester" opens the next one, and so on —
    until the program's total units (BCOMP 144, MCOMP 96) are submitted: the
    last semester only offers the units left, and there's no semester after
    it. Both
    share `SkillTree.astro` so a tile sits in the same place in each. Tree
    tabs (`?tab=`): **Program path**, **Majors/Specialisations** (all of them
    with progress bars; `?major=`, default the closest — never a commitment —
    plus a "How to complete" guide for the one viewed, written from its rules),
    **All courses**. `?course=` opens a tile's detail.
  Dashboard, About and `/profile/` never get a hamburger.
- **`/profile/`** — the one account's program, and "start as a new student"
  / "start with the demo history" resets. Linked from the Course Planner
  drawer.

## Data

- **`courses` / `prerequisites` tables** — the catalogue, loaded from the JSON
  on every boot by `src/lib/catalogue.ts` (reference data, replaced each
  time); the planner reads courses and prerequisite links from them.
- **`src/lib/data/*.json`** — ANU Programs and Courses data (BCOMP, MCOMP, 7
  majors, 7 specialisations, SoCo courses + the external courses they name,
  offerings per year, TD tags). Refresh with `node scripts/fetch-anu-data.ts`;
  never hand-edit. `src/lib/catalogue.ts` loads it (program rules are
  transcribed there, each quoting its source line).
- **`src/lib/requisites.ts`** — parses requisite text into an AND/OR tree
  (inline "or" binds tighter than AND; an OR on its own line splits
  alternatives). **`src/lib/requirements.ts`** — parses major/spec rules and
  computes progress (each course counts toward one program rule; a
  major/specialisation counts every course, so two majors whose courses are
  all taken both show complete). **`src/lib/planner.ts`** — per-semester
  tile states + "needed", every major's progress, `canAdd` (open, offered,
  compatible, ≤ 24 units or what the program has left), tabs/tiers.
- `student` — the single account (row 1): program code and first semester
  (majors are never chosen — the user wants them as an open reminder).
  Created on first visit with the demo history from `src/lib/demo.ts`. A
  "fresh" reset makes the current semester its first — no earlier semesters.
- `enrolments` — semesters whose selection is submitted. Only submitted
  semesters' courses count as done for later semesters.
- `semesters` — reference data seeded by migration (2025–2028), dates from
  the ANU university calendar (first teaching day → last exam day). Current semester =
  latest one that has started (`src/lib/plans.ts`).
- `planned_courses` — a course code + title in a semester's plan. Written only
  via `POST /api/plan` (add is checked by `canAdd`: open, not submitted, ≤ 24
  units).
- The starter's guestbook UI is gone; `/api/events` (SSE) stays because the
  deploy workflow checks it.

## Rules

- The user reviews visual/design changes themselves. Don't screenshot or
  browse-check the app to judge the design unless asked; say where to look.
- Don't fill in areas the user has said they'll design (Dashboard) — leave
  them blank until asked.
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
