import type { APIRoute } from "astro";
import { resetDemo, setProgram } from "../../lib/student";

// Writes for the account: choosing the program (program=…), or resetting the
// demo (reset=fresh|history). A plain form POST, then a 303 back to the page
// it came from (same-site paths only).
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const backField = String(form.get("back") ?? "");
  const back = /^\/(?!\/)/.test(backField) ? backField : "/profile/";

  const reset = form.get("reset");
  if (reset === "fresh" || reset === "history") {
    resetDemo(reset);
    return redirect(`/profile/?reset=${reset}`, 303);
  }

  if (!setProgram(String(form.get("program") ?? ""))) return new Response("Unknown program", { status: 400 });
  return redirect(back, 303);
};
