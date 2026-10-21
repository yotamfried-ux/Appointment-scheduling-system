// Which message namespaces the browser needs on a page. Every page used to ship the whole Hebrew catalog (~67 KB) inside its HTML; the public pages customers open on a phone
// now ship only what their client components read. Server components read messages on the server and need none of this.
// Safe by construction: any path not listed here keeps the full catalog, so a page is only trimmed when its list is explicit and covered by tests/unit/client-messages.test.ts.
// A page may only be trimmed if every way out of it is a full page load (see the note in clientNamespacesFor).

/** Used by the client pieces every page carries: the consent banner, the toaster, the theme switcher, the log-out button, the error screen. */
const SHARED = ["common", "nav", "errors", "legal"] as const;

const BOOKING = [...SHARED, "booking", "waitlist", "public"] as const;

/** null = the whole catalog. */
export function clientNamespacesFor(pathname: string | null | undefined): readonly string[] | null {
  if (!pathname) return null;
  if (pathname === "/book" || pathname.startsWith("/book/")) return BOOKING;
  // Only /book is trimmed. The root layout is not rendered again on a client-side navigation, so a page that links to another page with <Link> keeps the catalog it
  // started with: "/" -> /auth/sign-up showed raw keys, and login -> /dashboard would too. /book leaves through plain <a> links (full load) or to server-rendered pages.
  return null;
}

export function pickNamespaces<T extends Record<string, unknown>>(messages: T, namespaces: readonly string[] | null): Partial<T> | T {
  if (!namespaces) return messages;
  return Object.fromEntries(Object.entries(messages).filter(([k]) => namespaces.includes(k))) as Partial<T>;
}
