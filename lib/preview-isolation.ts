/**
 * Production Supabase Project Reference.
 * Any Preview deployment attempting to connect to this ref must be blocked
 * to guarantee complete isolation of production data.
 */
export const PROD_SUPABASE_REF = "abhadytskhgwkrlmceew";

/**
 * Returns true if running in Vercel's preview deployment environment.
 * VERCEL_ENV is injected by Vercel server runtime and cannot be spoofed by client headers.
 */
export function isPreviewEnvironment(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

/**
 * Checks whether this deployment is a Preview environment WITHOUT an authorized dedicated database.
 * Returns true if:
 * 1. We are in Vercel Preview (process.env.VERCEL_ENV === 'preview')
 * AND
 * 2. Either no Supabase URL/key is configured, or the configured URL points to Production (contains PROD_SUPABASE_REF),
 *    or is a placeholder/invalid URL.
 */
export function isPreviewWithoutDb(): boolean {
  if (process.env.VERCEL_ENV !== "preview") {
    return false;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // No connection parameters provided
  if (!url || !key || url.trim() === "" || key.trim() === "") {
    return true;
  }

  // Strictly block connecting to the production database from Preview
  if (url.includes(PROD_SUPABASE_REF)) {
    return true;
  }

  // Placeholder or dummy URLs
  if (
    url.includes("placeholder") ||
    url.includes(".invalid") ||
    url.includes("preview-isolated") ||
    url.includes("localhost") ||
    url.includes("127.0.0.1")
  ) {
    return true;
  }

  return false;
}
