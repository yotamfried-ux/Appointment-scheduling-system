import "server-only";
// The ONLY module that holds the Supabase secret key (bypasses RLS). Importable only from the files named in eslint.config.mjs
// (an exact allow-list: four job routes, the Resend webhook, and a handful of modules), plus scripts/check-bundle.sh (docs/05 §5.1). Every function it calls is a
// SECURITY DEFINER RPC granted to service_role alone, and takes the tenant explicitly — never from the request body.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timeoutFetch } from "@/platform/db-timeout";

let client: SupabaseClient | null = null;

export function systemDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("system-db is not configured"); // fail closed: never fall back to the publishable key
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch() } });
  return client;
}
