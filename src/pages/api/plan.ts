import type { APIRoute } from "astro";
import { addPlannedCourse, getSemester, removePlannedCourse } from "../../lib/plans";

// Writes for a semester plan, from its Add Course section: a plain form POST,
// then a 303 back to that section.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const semesterId = String(form.get("semester") ?? "");
  if (!getSemester(semesterId)) return new Response("Unknown semester", { status: 400 });

  const back = `/plan/${semesterId}/add/`;
  const removeId = Number(form.get("remove"));
  if (removeId) {
    removePlannedCourse(semesterId, removeId);
    return redirect(back, 303);
  }
  const code = String(form.get("code") ?? "").trim().toUpperCase().slice(0, 12);
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  if (!code || !title) return redirect(back, 303);
  addPlannedCourse(semesterId, code, title);
  return redirect(`${back}?added=${encodeURIComponent(code)}`, 303);
};
