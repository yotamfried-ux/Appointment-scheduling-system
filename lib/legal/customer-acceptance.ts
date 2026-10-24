// What a customer (end user who books) has accepted in THIS browser. The customer accepts the terms and the privacy policy once; the browser remembers which versions.
// The server never tells a browser whether it accepted before (no enumeration): it only validates the versions it receives and stores them with the booking / waitlist entry.
// Storage is a convenience only: if it is blocked the box is simply shown every time.
import { LEGAL } from "@/lib/legal/config";

export const ACCEPTANCE_KEY = "tori_terms_accepted";

/** The versions this build shows, as the API expects them. */
export const currentAcceptance = () => ({ terms: LEGAL.terms.version, privacy: LEGAL.privacy.version }) as const;

/** True when this browser already accepted the CURRENT version of both documents. */
export function hasAcceptedCurrent(): boolean {
  try {
    const raw = window.localStorage.getItem(ACCEPTANCE_KEY);
    if (!raw) return false;
    const v = JSON.parse(raw) as { terms?: unknown; privacy?: unknown } | null;
    return v?.terms === LEGAL.terms.version && v?.privacy === LEGAL.privacy.version;
  } catch {
    return false;
  }
}

export function rememberAcceptance(): void {
  try {
    window.localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify(currentAcceptance()));
  } catch {
    /* storage unavailable: the box is shown again next time, nothing else changes */
  }
}
