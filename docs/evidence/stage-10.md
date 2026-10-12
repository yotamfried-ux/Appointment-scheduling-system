# Evidence — Stage 10: customer ICS + legal pages, cookies, accessibility statement (no external-calendar sync)

Plan: `docs/plans/stage-10-calendar-legal.md` · decision D23 (the owner chose to keep calendar data in the app; D12 is superseded; CAL-01..04 and CAL-06 are closed as "won't do"). Evidence is for the commit that contains this file.

| Layer | Result |
|---|---|
| Lint / typecheck / build / bundle secret scan / Gitleaks (local) | PASS (exit 0 each) |
| Unit (vitest) | PASS — 448 (adds 7 ICS: CRLF, UTC times, stable UID, SEQUENCE, deterministic bytes, escaping and line-injection, 75-octet folding of Hebrew without splitting characters, TENTATIVE/reminder; 6 consent: gate before a decision, explicit yes only, unregistered categories never allowed, corrupted cookies never count as consent). Negative control: newline escaping removed ⇒ the injection test fails |
| DB (pgTAP `090_legal`) | PASS — 614 checks total; schema lint empty. Acceptances: own rows only, append-only (no update/delete), cannot record for another user, versions must look like dates, history kept, anonymous refused |
| E2E `legal-calendar.spec.ts` (desktop + mobile-360) | PASS — 24 runs. **ICS:** content-type/disposition/no-store, DTSTART/DTEND equal an independently computed UTC instant, UID = appointment id + host, nothing private in the file (the private link is not included), every line ≤ 75 octets, two downloads are byte-identical, a change keeps UID and raises SEQUENCE, hostile service name cannot add ATTENDEE/ALARM lines, cancelled/tampered/wrong-scope token ⇒ one generic 404 · **Legal pages** (privacy, terms, cookies, accessibility): title, version, "draft, not legally reviewed" notice, 4-link footer, axe WCAG 2.2 AA, no overflow, keyboard reaches the skip link first, contact is a visible placeholder not an invented address · **No tracking:** anonymous browsing across 9 pages sets zero cookies and contacts only this site; owners get only the httpOnly `sb-…-auth-token` cookie. Negative control: a third-party image added to the layout ⇒ this test fails · **Acceptance gate:** off by default outside production; with the test header on, owner pages redirect to the acceptance page, submitting unchecked records nothing, checking records the server's current versions, an older recorded version asks again and history is kept, the page is closed to anonymous visitors |
| Visual | privacy, terms, cookies, accessibility and the acceptance page at 360 and 1280, reviewed by eye |
| Full Playwright suite | PASS — 431 passed, 1 skipped (pre-existing), exit status 0 |

## Found and fixed while verifying
- The ICS response's `Referrer-Policy` is overridden globally and is meaningless for a file download → removed the header and the assertion rather than claim it.
- Test fixtures cannot edit a booked slot (the appointment guard rightly refuses); `updated_at` and the snapshot are placed with triggers bypassed in the test only.
- The cookies page listed the theme preference as a cookie; it is browser local storage → corrected the text.

## Known limitations (not claimed)
- **The legal texts are drafts**, written from what the system does. They are not legal advice and must be reviewed by counsel before launch; the contact and the accessibility coordinator are placeholders (`NEXT_PUBLIC_LEGAL_CONTACT`, `NEXT_PUBLIC_A11Y_CONTACT`). Data location, retention periods and liability wording are explicitly left open in the text.
- The accessibility statement describes automated (axe) and developer-run manual checks; **no external accessibility audit** has been done and no conformance is claimed.
- **No consent banner is shown because there is nothing optional to consent to** (no analytics, ads or third-party embeds). The framework exists; the day a category is registered the banner appears and the regression test forces the gate.
- Acceptance is enforced on the owner screens, not on the API, and not for customers of a business (they accept nothing today; the booking page links the privacy policy in its footer).
- The ICS file is a one-time download: later changes do not reach a calendar that already has the event (no sync, by decision). A reschedule would need a new download.
- Production defaults the acceptance gate **on**: every existing owner will be asked to accept once after deploy.
- CI not yet run on this commit.
