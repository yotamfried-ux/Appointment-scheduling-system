import { LEGAL } from "../../../lib/legal/config";

/** What a customer sends with a public booking / waitlist request: the CURRENT versions of the terms and the privacy policy. */
export const ACCEPTED = { terms: LEGAL.terms.version, privacy: LEGAL.privacy.version } as const;

/** The key the browser uses to remember the acceptance (lib/legal/customer-acceptance.ts). */
export const ACCEPTANCE_KEY = "tori_terms_accepted";

/** Playwright storage state of a browser that already accepted the current versions: the booking form shows no box. */
export const acceptedStorageState = (origin: string) => ({
  cookies: [],
  origins: [{ origin, localStorage: [{ name: ACCEPTANCE_KEY, value: JSON.stringify(ACCEPTED) }] }],
});
