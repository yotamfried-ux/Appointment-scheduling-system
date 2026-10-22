"use server";

import { redirect } from "next/navigation";
import { LEGAL } from "@/lib/legal/config";
import { missingAcceptances } from "@/lib/legal/gate";
import { createClient } from "@/lib/supabase/server";
import { sessionIsLive } from "@/lib/auth/live-session";

/** Records acceptance of the CURRENT versions only (the version comes from the server, never from the form), then continues. */
export async function acceptLegalAction(form: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims || !(await sessionIsLive(supabase))) redirect("/auth/login");
  if (form.get("agree") !== "yes") redirect("/legal/accept?error=1");
  for (const doc of await missingAcceptances(supabase)) {
    const { error } = await supabase.rpc("accept_legal", { p_doc: doc, p_version: LEGAL[doc].version });
    if (error) redirect("/legal/accept?error=1");
  }
  redirect("/dashboard");
}
