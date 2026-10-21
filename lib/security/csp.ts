/**
 * Content-Security-Policy builder (docs/05 §5.5).
 * Pure function so it can be unit tested without a Next.js runtime.
 */
export interface CspOptions {
  nonce: string;
  isDev?: boolean;
  /** Origin of the Supabase project, e.g. https://abc.supabase.co */
  supabaseUrl?: string;
}

export function buildCsp({ nonce, isDev = false, supabaseUrl }: CspOptions): string {
  const connect = ["'self'"];
  if (supabaseUrl) {
    const url = new URL(supabaseUrl);
    connect.push(url.origin);
    // Realtime uses a websocket on the same host.
    connect.push(`${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
  }
  if (isDev) connect.push("ws://localhost:*", "http://127.0.0.1:*");

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", `'nonce-${nonce}'`],
    // React renders style="" attributes; blocking them breaks layout libraries.
    // Accepted trade-off, scoped to attributes only (not <style> elements).
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": connect,
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}
