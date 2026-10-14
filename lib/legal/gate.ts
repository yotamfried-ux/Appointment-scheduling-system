import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCEPTED_DOCS, LEGAL, type AcceptedDoc } from "@/lib/legal/config";
import { isProductionLike } from "@/lib/env";

const isProduction = isProductionLike;

/**
 * CMP-03. On in production, off elsewhere so development and the other tests are not interrupted. LEGAL_GATE=on|off overrides. Outside production a test can switch it
 * on for its own requests with the x-test-legal-gate header, and only when ALLOW_TEST_LEGAL_GATE=1.
 */
export async function legalGateActive(): Promise<boolean> {
  const forced = process.env.LEGAL_GATE;
  if (forced === "on") return true;
  if (forced === "off") return false;
  if (isProduction()) return true;
  if (process.env.ALLOW_TEST_LEGAL_GATE === "1" && (await headers()).get("x-test-legal-gate") === "on") return true;
  return false;
}

/** Documents whose CURRENT version this user has not accepted. A newer version means accepting again; older acceptances are kept as history. */
export async function missingAcceptances(supabase: SupabaseClient): Promise<AcceptedDoc[]> {
  const { data } = await supabase.from("legal_acceptances").select("doc, version");
  const have = new Set((data ?? []).map((r) => `${r.doc}:${r.version}`));
  return ACCEPTED_DOCS.filter((d) => !have.has(`${d}:${LEGAL[d].version}`));
}
