import type { APIRoute } from "astro";
import { getCourse } from "../../lib/catalogue";
import { addPlannedCourse, removePlannedCourse, reopenSemester, submitSemester } from "../../lib/plans";
import { canAdd, planView } from "../../lib/planner";

// Writes for a semester plan, from its Add Course section — a plain form
// POST, then a 303 back:
// - code=…: add a course to the semester's selection (a draft), through the
//   same check the tree shows, so a locked course can't be added by posting
//   its code;
// - remove=<id>: take one out of the selection;
// - action=submit: submit the selection (at least one course, all
//   prerequisites met) — from then on it counts as done for later semesters;
// - action=reopen: back to a draft, to change it.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const semesterId = String(form.get("semester") ?? "");
  const view = planView(semesterId);
  if (!view) return new Response("Unknown semester", { status: 400 });

  const add = `/plan/${semesterId}/add/`;
  const backField = String(form.get("back") ?? "");
  const back = backField.startsWith(add) ? backField : add;

  const action = form.get("action");
  if (action === "submit") {
    if (view.planned.length === 0 || view.broken.length > 0) return redirect(back, 303);
    submitSemester(semesterId);
    return redirect(`${add}?submitted=1`, 303);
  }
  if (action === "reopen") {
    reopenSemester(semesterId);
    return redirect(add, 303);
  }

  const removeId = Number(form.get("remove"));
  if (removeId) {
    if (!view.submitted) removePlannedCourse(semesterId, removeId);
    return redirect(back, 303);
  }

  const code = String(form.get("code") ?? "").trim().toUpperCase().slice(0, 12);
  const course = getCourse(code);
  if (!course) return redirect(add, 303);
  // keep the tree on the tab (and major) the course was added from
  const params = new URLSearchParams();
  for (const key of ["tab", "major"]) if (form.get(key)) params.set(key, String(form.get(key)));
  params.set("course", code);
  const check = canAdd(view, code);
  if (!check.ok) {
    params.set("refused", code);
    return redirect(`${add}?${params}#course-detail`, 303);
  }
  addPlannedCourse(semesterId, code, course.title);
  params.set("added", code);
  return redirect(`${add}?${params}#course-detail`, 303);
};
