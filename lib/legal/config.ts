// Versions of the legal documents. Changing a version makes signed-in owners accept the new text before they continue (CMP-03),
// and prompts end customers to accept the updated terms/privacy once per browser.
// Written from verified system behavior and reconciled against Calmark-grade Israeli SaaS standards; see docs/legal/open-decisions.md & LEGAL_HARDENING_MASTER_SPEC_2026-11.md.
export const LEGAL = {
  terms: { version: "2026-11-14", effective: "14.11.2026" },
  privacy: { version: "2026-11-14", effective: "14.11.2026" },
  cookies: { version: "2026-11-14", effective: "14.11.2026" },
  accessibility: { version: "2026-11-14", effective: "14.11.2026", lastReview: "14.11.2026" },
  /** The operator behind the service ("תורים" brand). Business registration details are added once tax registration is active (docs/legal/open-decisions.md G-01). */
  operator: { name: "D2R", brand: "תורים" },
  /** Set NEXT_PUBLIC_LEGAL_CONTACT / NEXT_PUBLIC_A11Y_CONTACT in the environment; falls back to official mailbox yotam.fried@gmail.com (docs/legal/open-decisions.md G-02). */
  contact: process.env.NEXT_PUBLIC_LEGAL_CONTACT || "yotam.fried@gmail.com",
  accessibilityContact: process.env.NEXT_PUBLIC_A11Y_CONTACT || null,
} as const;

/** The documents an owner must have accepted at their current version. */
export const ACCEPTED_DOCS = ["terms", "privacy"] as const;
export type AcceptedDoc = (typeof ACCEPTED_DOCS)[number];
