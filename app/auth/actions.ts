"use server";

import { headers } from "next/headers";
import { authErrorKey } from "@/lib/auth/errors";
import { createClient } from "@/lib/supabase/server";

// Auth runs on the server so the session cookie is written by the server with HttpOnly (docs/05 §5.2): JavaScript in the
// page (XSS, extensions) can never read the tokens. Server Actions also get Next.js' Origin/Host CSRF check (SEC-05).
export type AuthResult = { ok: true } | { ok: false; errorKey: string };
export type LoginResult = { ok: true; mfaRequired: boolean } | { ok: false; errorKey: string };

async function origin(): Promise<string> {
  // The configured address first: a forged Host / X-Forwarded-Host must never decide where the e-mail links point.
  for (const v of [process.env.APP_URL, process.env.NEXT_PUBLIC_SITE_URL]) {
    try {
      if (v) return new URL(v).origin;
    } catch {
      /* malformed value: try the next one */
    }
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`; // Supabase additionally enforces its exact redirect allow-list
}

const fail = (e: unknown): AuthResult => ({ ok: false, errorKey: authErrorKey(e) });
const str = (v: unknown, max = 256) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

export async function loginAction(input: { email: unknown; password: unknown }): Promise<LoginResult> {
  const email = str(input.email), password = str(input.password, 128);
  if (!email || !password) return { ok: false, errorKey: "invalid_credentials" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(error) as LoginResult;
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { ok: true, mfaRequired: !!aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2" };
}

export async function signUpAction(input: { email: unknown; password: unknown }): Promise<AuthResult> {
  const email = str(input.email), password = str(input.password, 128);
  if (!email || !password) return { ok: false, errorKey: "generic" };
  const { error } = await (await createClient()).auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await origin()}/auth/confirm?next=/dashboard` },
  });
  return error ? fail(error) : { ok: true };
}

export async function forgotPasswordAction(input: { email: unknown }): Promise<AuthResult> {
  const email = str(input.email);
  if (!email) return { ok: false, errorKey: "generic" };
  const { error } = await (await createClient()).auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/update-password` });
  return error ? fail(error) : { ok: true }; // same outcome whether or not the account exists (ACC-02)
}

export async function updatePasswordAction(input: { password: unknown }): Promise<AuthResult> {
  const password = str(input.password, 128);
  if (!password) return { ok: false, errorKey: "weak_password" };
  const { error } = await (await createClient()).auth.updateUser({ password });
  return error ? fail(error) : { ok: true };
}

export async function logoutAction(): Promise<void> {
  await (await createClient()).auth.signOut();
}
