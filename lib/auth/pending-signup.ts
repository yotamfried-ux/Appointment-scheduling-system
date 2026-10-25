import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { isProductionLike } from "@/lib/env";

const COOKIE_NAME = "pending_signup_auth";
export const PENDING_SIGNUP_TTL_SECONDS = 900; // 15 minutes

function getKey(): Buffer {
  const secret = process.env.BOOKING_TOKEN_SECRET ?? "fallback_dev_secret_at_least_32_characters_long_for_safety";
  return createHash("sha256").update(secret).digest();
}

export function encryptPendingPayload(data: object): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptPendingPayload<T>(token: string): T | null {
  try {
    const [ivB64, tagB64, dataB64, extra] = token.split(".");
    if (!ivB64 || !tagB64 || !dataB64 || extra !== undefined) return null;
    const key = getKey();
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function setPendingSignupCookie(input: { email: string; password: string }): Promise<void> {
  const cookieStore = await cookies();
  const payload = {
    email: input.email,
    password: input.password,
    exp: Date.now() + PENDING_SIGNUP_TTL_SECONDS * 1000,
  };
  const token = encryptPendingPayload(payload);
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProductionLike(),
    sameSite: "lax",
    maxAge: PENDING_SIGNUP_TTL_SECONDS,
    path: "/",
  });
}

export async function getPendingSignupCookie(): Promise<{ email: string; password: string } | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  const payload = decryptPendingPayload<{ email: string; password: string; exp: number }>(cookie.value);
  if (!payload || !payload.email || !payload.password || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return { email: payload.email, password: payload.password };
}

export async function clearPendingSignupCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
