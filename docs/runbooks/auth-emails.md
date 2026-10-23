# Sign-up, reset and other account e-mails (Supabase Auth)

These e-mails are sent by **Supabase Auth**, not by the app, so their text, sender and expiry live in the **hosted project's dashboard**. The repository holds the Hebrew versions (`supabase/templates/*.html`, subjects in `supabase/config.toml`); they apply automatically to the local stack, and have to be pasted into the hosted project once.

## What the owner reported (2026-10-23) and what fixes it
| Symptom | Cause | Fix |
|---|---|---|
| The link expires almost at once | the hosted "Email OTP expiration" (the repo's local value was 15 minutes) | set it to **3600** (one hour; the owner chose this, the repo's local value was 15 minutes) |
| "From Supabase", English text | the project uses Supabase's built-in sender and the default templates | custom SMTP (Resend) + the Hebrew templates below |
| An expired link was a dead end | — | fixed in the app: the error page now asks for the address and sends a new link |

## Steps in the Supabase dashboard (project `abhadytskhgwkrlmceew`)
1. **Authentication → Providers → Email → "Email OTP Expiration"** → `3600`. (Applies to the confirmation, reset and change links.)
2. **Authentication → Emails → SMTP Settings** → enable custom SMTP with Resend: host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key (create one in Resend with "sending access"; enter it only in the dashboard), sender `noreply@mail.d2ryf.com` (the verified domain), sender name `תורים`. This removes "Supabase" from the sender and lifts the built-in limit of a few e-mails per hour.
3. **Authentication → Emails → Templates:** for each of *Confirm sign up, Magic link, Change email address, Invite user, Reset password, Reauthentication* paste the HTML from `supabase/templates/` (`confirmation`, `magic_link`, `email_change`, `invite`, `recovery`, `reauthentication`) and the subject from `supabase/config.toml`.
4. **Authentication → URL Configuration:** Site URL `https://turim.d2ryf.com`; redirect allow-list only that domain. (The links in the templates are built from the Site URL.)
5. Check: sign up with a fresh address → the mail is in Hebrew from `תורים <noreply@mail.d2ryf.com>`, the button works, and the link works within the hour (and shows "link no longer valid" with a resend form after it).

## Notes
- A link opens `/auth/confirm` and verifies on the first GET. Some mail providers pre-open links to scan them, which can use the link up before the person clicks it; if that is ever reported, the fix is a confirm page with a button (one more tap) instead of verifying on GET.
- Booking and waitlist e-mails (to customers and owners) are sent by the app through Resend and share the same look (`modules/notifications/templates.ts`).
