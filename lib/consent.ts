// Cookie/tracking consent (CMP-01). Today the site sets ONLY essential cookies, so there is nothing to ask and no banner is shown (a banner without a real
// choice is noise). This module is the gate for the day an optional category exists: register it in OPTIONAL_CATEGORIES and the banner appears by itself,
// and `allowed()` stays false until the visitor has chosen. tests/e2e/consent-cookies.spec.ts (cookies, browser storage, origins) and the "no tracking without consent" block of legal-calendar.spec.ts fail if anything non-essential is set or loaded without it.
export const CONSENT_COOKIE = "tori_consent";
export const CONSENT_DAYS = 180;

export interface OptionalCategory {
  id: string;
  label: string;
  description: string;
}
/** Empty on purpose: no analytics, no advertising, no third-party embeds. */
export const OPTIONAL_CATEGORIES: readonly OptionalCategory[] = [];

export interface StoredConsent {
  v: 1;
  at: number;
  choices: Record<string, boolean>;
}

export function parseConsent(raw: string | null | undefined): StoredConsent | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(decodeURIComponent(raw)) as Partial<StoredConsent>;
    if (j.v !== 1 || typeof j.at !== "number" || !j.choices || typeof j.choices !== "object") return null;
    const choices: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(j.choices)) if (typeof v === "boolean") choices[k] = v;
    return { v: 1, at: j.at, choices };
  } catch {
    return null;
  }
}

export const serializeConsent = (choices: Record<string, boolean>, at = Date.now()) => encodeURIComponent(JSON.stringify({ v: 1, at, choices } satisfies StoredConsent));

/** Optional things may run only after an explicit yes. Undecided, unknown or declined ⇒ false. */
export function allowed(category: string, stored: StoredConsent | null, categories: readonly OptionalCategory[] = OPTIONAL_CATEGORIES): boolean {
  if (!categories.some((c) => c.id === category)) return false;
  return stored?.choices[category] === true;
}

/** The banner is needed only when some optional category has no recorded answer yet. */
export function needsDecision(stored: StoredConsent | null, categories: readonly OptionalCategory[] = OPTIONAL_CATEGORIES): boolean {
  return categories.some((c) => typeof stored?.choices[c.id] !== "boolean");
}

export const readConsentCookie = (cookieHeader: string) => parseConsent(cookieHeader.split("; ").find((c) => c.startsWith(`${CONSENT_COOKIE}=`))?.slice(CONSENT_COOKIE.length + 1));
