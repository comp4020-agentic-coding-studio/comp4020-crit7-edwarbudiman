# Progress: the skill-tree course planner (25 Sep 2026)

One working session, building on the Canvas shell in
[`852cf17`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-edwarbudiman/commit/852cf17).
Nothing from this session is committed yet. Cite the commit once it exists.

## Where it started

The shell had the Canvas rail, drawers and a semester plan whose Add Course
section was a free-text form (code + title). There was no course data behind it.
Three scraped files sat in `src/lib/data/`: School of Computing (SoCo) courses,
the Bachelor of Computing (BCOMP) majors, and the two programs.

> please use our @src/lib/data/ for the way we gonna do the course planner … i
> want it to have something like skill tree like in a game, rather than adding
> conventionally.

## 1. Brief and feedback first

Before building, I asked for a read of the data. It found the problems that
shaped everything after:

- **Prerequisites lost AND/OR.** `prerequisiteCourses` was a flat list, so
  COMP1110 appeared to need COMP1100 *and* COMP1130 *and* COMP1730, when it
  needs only one of them.
- **45 courses were missing.** They're outside SoCo (MATH, ENGN, INFS, …) but
  named by prerequisites and majors.
- **No semester offerings.** No record of which courses run in S1 or S2.
- **No Transdisciplinary Problem-Solving (TD) tags**, so BCOMP's 12-unit TD
  rule couldn't be checked.
- **Master of Computing (MCOMP) specialisations had no course lists**, and two
  of their links were broken.

> please pull the missing data or broken link, also be aware of that AND and OR
> relationship for the requirement … BCMP and MCOMP please, what happened with
> the MCOMP now

## 2. Data, from public ANU sources only

`scripts/fetch-anu-data.ts` refreshes `src/lib/data/` from ANU Programs and
Courses:

- **Offerings for 2026 and 2027, and the TD tag (157 courses)**, from the
  site's own CourseSearch endpoint. That's the endpoint the catalogue search
  page calls.
- **58 non-SoCo courses**, from their course pages.
- **All 7 MCOMP specialisations.** The 2027 program page links only 5.
  Machine Learning (MCHL-SPEC) now only has a page in the 2026 catalogue, so
  it comes from there. The file records which year each page came from.
- **21 codes don't resolve.** They're retired courses, mostly in "incompatible
  with" lists.

## 3. Reading the rules

- **`src/lib/requisites.ts`** turns ANU's requisite text into an AND/OR tree.
  It follows the house style of those texts:
  - an OR on its own line (or after a semicolon, or before a new "have…"
    clause) splits whole alternatives;
  - AND binds next, and an inline "or" binds tightest.

  So COMP2310 reads as (COMP1110 | COMP1140) & (COMP2300 | ENGN2219). It also
  handles unit counts ("6 units of 1000-level MATH"), program enrolment,
  "or currently enrolled", and conditions aimed at other programs' students.
  Permission codes and marks become non-blocking notes.
- **`src/lib/requirements.ts`** parses each major's and specialisation's rules
  (compulsory / at least N / up to N lists, level caps). It then computes
  progress so that each course counts toward one rule only.
- **The two programs' rules are transcribed** in `src/lib/catalogue.ts`, each
  quoting the line of the program page it comes from.

## 4. The skill tree (first version)

- **Tiles:** square course tiles in tiers by level, with a subject colour band.
- **Traced lines:** hovering a tile draws its prerequisites (solid = needed,
  dashed = one of several) and what it unlocks.
- **Detail panel:** prerequisites as a ticked All-of / One-of checklist, and
  the Add button.
- **A single-row `student` account** holds the program.
- **Adding is checked on the server** (`canAdd`): prerequisites met, offered
  this session, not incompatible, and within ANU's 24-unit full-time load.
- **Demo history:** three semesters of real BCOMP courses (`src/lib/demo.ts`),
  checked by a test to be offered in their session with prerequisites met.

## 5. Feedback: "hard to read", "confused how to select"

> for the path i need it to have these state 1. has finish it 2. selecting to
> take 2.1 need selecting, but pre-requisite not yet there 2.2 need selecting,
> pre requisite fine 2.3 future selecting, the one that being unlocked by
> selecting current 3. locked due not pre-requisite

Changes:

- **Tile states in words**, under every tile: Done, Taking, Needed · open,
  Open, Next / Needed · next, Needed · locked, Locked, "S1 only", Excluded.
- **"Needed" means on a requirement not yet filled.** It updates as you pick:
  taking COMP1100 drops COMP1130 off the path.
- **"Next" means unlocked by this semester's picks.** It's worked out by
  checking prerequisites as if the current semester were already done.
- **Each tier reads left to right** from done to locked.
- **The legend is a filter**, so you can hide Locked or Excluded.
- **"+ Take" / "Remove" buttons sit under the tiles** in Add Course. You no
  longer have to click a tile and then find a button in the side panel.
- **Planning is explicit steps**, with program cards.
- **"Start as a new student"** gives a first-semester demo with no history.

## 6. Feedback: majors are a reminder, not a commitment

> i meant, the majors itself, not something that you need to chose and you
> cannot change anymore, it rather be something that you can see as a reminder
> … you can separate it by tab rather than you keep it in one place

- **The major-choice step is gone.** So is the column that stored it (migration
  `0004`). The program is the only choice.
- **The tree has tabs:**
  - **Program path**: the program's own courses.
  - **Majors / Specialisations**: all of them as cards with progress bars,
    closest first. Click one to see its courses and what's left.
  - **All courses**: everything at the program's level.
- **A course's detail lists every major it counts toward.** The Requirements
  panel counts toward the closest major and links to "Compare all".

## 7. Feedback: deselecting a course

> whenever i already selecting some course, i want it to lose focus whenever we
> click outside the course box

These all close the course detail and drop `?course=` from the URL without a
reload:

- clicking outside the tiles and the panel;
- Escape;
- clicking the selected tile again;
- the panel's new ✕, which also works without JavaScript.

## 8. Feedback: too many closed courses; a new student isn't new

> it might be still confusing, why? that's because so many courses that
> closed or not open for the particular time. and also starting as a new
> student still have these 4 semester … make the courses from the json is
> open … please use database to keep all of these information … they need to
> submit first … when they done, now they have the new section called, add new
> courses to next semester, and so on.

- **Every course is open every semester.** Offerings are no longer checked.
  Only unmet prerequisites (or an incompatible course) close a course.
- **The catalogue lives in SQLite.** New `courses` and `prerequisites` tables
  are loaded from the ANU JSON on boot. The planner reads courses and the
  tree's prerequisite lines from them.
- **A fresh start is really fresh.** The account records its first semester.
  "Start as a new student" makes the current semester the first, so there are
  no previous semesters.
- **Select, then submit.** In Add Course you click a tile, then "Add to this
  semester" (the tiles' own Take buttons are gone). Picks fill four slots and
  stay a draft until **Submit**. The new `enrolments` table records submitted
  semesters, and only their courses count as done later on.
- **Next semester, and so on.** After submitting, "Add courses to next
  semester" links on. 2027 and 2028 semesters were added from the ANU
  university calendar (migration `0006`). The drawer gains "Plan ahead".
- **Add Course opens with a brief intro:** what the program needs (written
  from its rules), what majors are, and how to pick.

## How it was checked

- **`pnpm check` is green:** `astro check` reports 0 errors, and 89 tests pass
  against the built server.
- **`spec/catalogue.test.ts`** covers:
  - the parser on the tricky texts (COMP1110, COMP2310, COMP4670, ENGN4528's
    stray bracket, COMP2100's Bachelor of Science clause);
  - no named course lost from any requisite (it's either in the tree or in a
    note);
  - every rule's courses existing in the data;
  - no course counted twice;
  - the demo history being valid.
- **`spec/planner.test.ts`** covers the flow end to end: program first, the
  same tree in both sections, each tile state, "needed" and "next" updating
  after a pick, Take from a tile, locked courses refused even when posted
  directly, the Majors tab, MCOMP, both demo resets, the close link, a fresh
  student with no earlier semesters, and select → submit → next semester.
- **The design was reviewed by me in the browser**, not by the agent (per
  `CLAUDE.md`).

## Known limits

- **Offerings are fetched but deliberately unused** (every course is open
  every semester).
- **The calendar runs to 2028 S2.** That's the latest year ANU has published.
- **MCOMP on the BCOMP demo history can't be completed.** COMP1110 excludes the
  compulsory COMP7710. Demo MCOMP as a new student.
- **The TD tag comes from the 2027 catalogue.**
- **Course icons are monograms for now.** Artwork dropped into
  `src/assets/course-icons/<CODE>.png` replaces them.

## Next

- Commit this work, then cite it here and in `PROCESS.md`.
- Generate course artwork.
- Design the Dashboard (still deliberately blank).
