---
name: registration-form-requirements
description: >-
  Standardized protocol for architecting registration forms, password policies, input normalization,
  and full synchronization between application code and infrastructure providers (Supabase Auth).
  Use whenever creating or modifying sign-up forms, password constraints, authentication rules,
  or onboarding pipelines.
---

# Registration Form Requirements & Auth Synchronization

A comprehensive guide for configuring user registration forms, enforcing password and contact invariants, and keeping application schemas perfectly aligned with backend auth providers.

## 1. Password Policy Invariants

When defining or modifying password policies (e.g. lowering friction from 12 to 6 characters while ensuring complexity):

### Core Rule: Synchronize Code and Infrastructure in Tandem
A password policy change must **never** be made only in the client form or only in the database. It must be applied simultaneously across four pillars:

1. **Validation Schemas (Zod)**:
   ```typescript
   // e.g. modules/auth/schemas.ts
   export const passwordSchema = z
     .string()
     .min(6, { message: "passwordMin6" })
     .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: "passwordLetterNumber" });
   ```
2. **Infrastructure / Auth Provider Settings (Supabase Auth / Firebase / Cognito)**:
   * Verify the provider's minimum password length matches the schema (e.g. minimum 6 characters).
   * Ensure provider-level validation does not reject submissions passing the app schema.
3. **Localized Error Messages (`messages/he.json`, `en.json`)**:
   * "על הסיסמה להכיל לפחות 6 תווים ולשלב אותיות ומספרים" (clear, friendly Hebrew guidance).
   * Update hint texts below input fields in real time.
4. **Automated Verification**:
   * Unit tests verifying edge cases: 5 chars (fail), 6 digits only (fail), 6 letters only (fail), 6 alphanumeric (pass), long passphrases (pass).

---

## 2. Contact Information Normalization

### Email Canonicalization
* Always normalize emails before persistence:
  ```typescript
  const canonicalEmail = rawEmail.trim().toLowerCase();
  ```
* For identity resolution, use normalized mailbox keys (ignoring Gmail dots and `+tag` suffixes) to prevent duplicate accounts and trial abuse, while preserving the user's typed address for outbound mail routing.

### Phone Number Normalization
* Always normalize phone inputs using an authoritative parser (`libphonenumber-js`):
  * Strip whitespace, parentheses, and dashes.
  * Standardize to international E.164 (e.g. `050-1234567` $\rightarrow$ `+972501234567`).
  * Never use unverified phone numbers typed into public booking forms to overwrite or claim account ownership (prevents account takeover).

---

## 3. Registration UX & Security Protocol

### Anti-Enumeration Design
* When a user attempts to sign up with an already registered email or phone:
  * Do not disclose account existence to unauthorized visitors.
  * Provide a safe, uniform response: e.g. "אם הכתובת קיימת במערכת, נשלח מייל לאימות והתחברות" or offer a direct "התחברות לחשבון קיים" flow with rate limiting.

### Atomic Account Creation
* The user registration, tenant/business row, default availability, and initial catalog items must be committed in a single atomic transaction (RPC or Server Action). Never leave "half-created" businesses.
* Unverified accounts must remain unindexed and prevented from publishing public booking links until email verification is completed.

---

## 4. Pre-launch Checklist for Registration Forms

- [ ] Schema allows minimum 6 characters with letters + digits combination.
- [ ] Supabase Auth / provider settings configured to allow 6-character passwords.
- [ ] Hebrew validation messages clearly explain the requirement next to the field.
- [ ] Password confirmation field validates equality with the primary password field.
- [ ] Email and phone inputs trim whitespace and normalize to canonical format.
- [ ] Rate limiting is active on registration endpoints to prevent bot flooding.
- [ ] Unit tests pass for valid and invalid password/email combinations.
