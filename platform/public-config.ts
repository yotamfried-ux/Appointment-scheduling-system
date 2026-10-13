// The configuration the PAGES need (not the database path): the Supabase URL and the publishable key are compiled into the app at build time.
// Readiness used to look only at the system path, so a deployment without the publishable key answered "ready" while every page crashed.
// Returns variable NAMES only (never a value) so the operator log can say exactly what is missing.
export function missingPublicConfig(env: { url?: string; key?: string }): string[] {
  const missing: string[] = [];
  if (!env.url || env.url.trim() === "") missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.key || env.key.trim() === "") missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}
