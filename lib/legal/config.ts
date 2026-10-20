// Versions of the legal documents. Changing a version makes the signed-in owners accept the new text before they continue (CMP-03).
// The texts are DRAFTS written from what the system actually does; they have not been reviewed by counsel (docs/05 §14). Replace the contact placeholders before launch.
export const LEGAL = {
  terms: { version: "2026-10-20", effective: "20.10.2026" },
  privacy: { version: "2026-10-20", effective: "20.10.2026" },
  cookies: { version: "2026-10-12", effective: "12.10.2026" },
  accessibility: { version: "2026-10-12", effective: "12.10.2026", lastReview: "12.10.2026" },
  /** The operator behind the service. Business registration details are to be added once the business is registered (docs/legal/open-decisions.md). */
  operator: { name: "D2R" },
  /** Set NEXT_PUBLIC_LEGAL_CONTACT / NEXT_PUBLIC_A11Y_CONTACT in the environment; until then the pages show a visible placeholder instead of an invented address. */
  contact: process.env.NEXT_PUBLIC_LEGAL_CONTACT || null,
  accessibilityContact: process.env.NEXT_PUBLIC_A11Y_CONTACT || null,
} as const;

/** The documents an owner must have accepted at their current version. */
export const ACCEPTED_DOCS = ["terms", "privacy"] as const;
export type AcceptedDoc = (typeof ACCEPTED_DOCS)[number];
