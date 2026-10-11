import "server-only";
// The ONLY module that holds the Supabase secret key (bypasses RLS). Reachable only from the public booking module,
// jobs and webhooks (eslint no-restricted-imports + scripts/check-bundle.sh, docs/05 §5.1). Every function it calls is a
// SECURITY DEFINER RPC granted to service_role alone, and takes the tenant explicitly — never from the request body.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function systemDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("system-db is not configured"); // fail closed: never fall back to the publishable key
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
