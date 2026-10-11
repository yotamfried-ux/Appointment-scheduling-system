import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/modules/booking/token";
import { segmentsFromSlots } from "@/modules/availability/segments";

const env = { BOOKING_TOKEN_SECRET: "s".repeat(40), BOOKING_TOKEN_SECRET_PREVIOUS: "p".repeat(40) } as unknown as NodeJS.ProcessEnv;
const ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-14T10:00:00Z");

describe("customer capability tokens (SEC-06)", () => {
  it("round-trips and carries appointment, scope and expiry", () => {
    const t = signToken({ appointmentId: ID, scope: "cancel", ttlSeconds: 3600, now: NOW }, env);
    const v = verifyToken(t, "cancel", env, NOW + 1000);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload).toMatchObject({ a: ID, s: "cancel" });
  });
  it("tokens are unique (jti) even for the same appointment and time", () => {
    const a = signToken({ appointmentId: ID, scope: "view", ttlSeconds: 60, now: NOW }, env);
    const b = signToken({ appointmentId: ID, scope: "view", ttlSeconds: 60, now: NOW }, env);
    expect(a).not.toBe(b);
  });
  it("expired, wrong scope, tampered payload, tampered signature and garbage are all the same opaque failure", () => {
    const t = signToken({ appointmentId: ID, scope: "view", ttlSeconds: 60, now: NOW }, env);
    expect(verifyToken(t, "view", env, NOW + 61_000)).toEqual({ ok: false }); // expired
    expect(verifyToken(t, "cancel", env, NOW)).toEqual({ ok: false }); // a view token can never cancel
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), a: "22222222-2222-4222-8222-222222222222" })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, "view", env, NOW)).toEqual({ ok: false }); // payload swapped
    expect(verifyToken(`${body}.${sig.slice(0, -2)}AA`, "view", env, NOW)).toEqual({ ok: false }); // signature altered
    expect(verifyToken(`${body}.`, "view", env, NOW)).toEqual({ ok: false });
    for (const g of ["", "x", "a.b.c", "....", "%%%.%%%", null, undefined, 42, {}, "a".repeat(600)]) expect(verifyToken(g, "view", env, NOW)).toEqual({ ok: false });
  });
  it("a token signed with another secret is rejected", () => {
    const t = signToken({ appointmentId: ID, scope: "view", ttlSeconds: 60, now: NOW }, { BOOKING_TOKEN_SECRET: "z".repeat(40) } as unknown as NodeJS.ProcessEnv);
    expect(verifyToken(t, "view", env, NOW)).toEqual({ ok: false });
  });
  it("key rotation: a token signed with the old current secret keeps working while it is configured as PREVIOUS, and stops when removed", () => {
    const old = signToken({ appointmentId: ID, scope: "view", ttlSeconds: 3600, now: NOW }, { BOOKING_TOKEN_SECRET: "p".repeat(40) } as unknown as NodeJS.ProcessEnv);
    const rotated = { BOOKING_TOKEN_SECRET: "n".repeat(40), BOOKING_TOKEN_SECRET_PREVIOUS: "p".repeat(40) } as unknown as NodeJS.ProcessEnv;
    expect(verifyToken(old, "view", rotated, NOW).ok).toBe(true);
    expect(verifyToken(signToken({ appointmentId: ID, scope: "view", ttlSeconds: 60, now: NOW }, rotated), "view", rotated, NOW).ok).toBe(true); // new tokens use the new secret
    expect(verifyToken(old, "view", { BOOKING_TOKEN_SECRET: "n".repeat(40) } as unknown as NodeJS.ProcessEnv, NOW)).toEqual({ ok: false }); // previous removed
  });
  it("fails closed when the secret is missing or short", () => {
    expect(() => signToken({ appointmentId: ID, scope: "view", ttlSeconds: 60 }, {} as NodeJS.ProcessEnv)).toThrow();
    expect(() => signToken({ appointmentId: ID, scope: "view", ttlSeconds: 60 }, { BOOKING_TOKEN_SECRET: "short" } as unknown as NodeJS.ProcessEnv)).toThrow();
    expect(verifyToken("a.b", "view", {} as NodeJS.ProcessEnv, NOW)).toEqual({ ok: false });
  });
});

describe("segmentsFromSlots", () => {
  const w = [{ from: 540, to: 720 }, { from: 780, to: 900 }];
  const slot = (m: number) => ({ startUtc: "", endUtc: "", local: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` });
  it("marks coverage, in-hours-but-unavailable and the gap between windows, merged", () => {
    const seg = segmentsFromSlots(w, [slot(600), slot(630)], 60);
    expect(seg).toEqual([
      { start: 540, end: 600, state: "booked" },
      { start: 600, end: 690, state: "free" },
      { start: 690, end: 720, state: "booked" },
      { start: 720, end: 780, state: "closed" },
      { start: 780, end: 900, state: "booked" },
    ]);
  });
  it("overlays the selected slot", () => {
    const seg = segmentsFromSlots(w, [slot(600)], 60, { selected: "10:00" });
    expect(seg.find((s) => s.state === "selected")).toEqual({ start: 600, end: 660, state: "selected" });
  });
});

describe("waitlist token scopes (stage 7)", () => {
  const env = { BOOKING_TOKEN_SECRET: "x".repeat(40) } as unknown as NodeJS.ProcessEnv;
  const scopes = ["view", "cancel", "wl_view", "wl_accept", "wl_decline", "wl_leave"] as const;
  it("each token verifies only for its own scope (a booking link cannot act on the waitlist, and vice versa)", () => {
    for (const s of scopes) {
      const t = signToken({ appointmentId: "id-1", scope: s, ttlSeconds: 60 }, env);
      for (const other of scopes) expect(verifyToken(t, other, env).ok, `${s} as ${other}`).toBe(other === s);
    }
  });
  it("an expired waitlist token is refused", () => {
    const t = signToken({ appointmentId: "e1", scope: "wl_accept", ttlSeconds: 1, now: Date.now() - 10_000 }, env);
    expect(verifyToken(t, "wl_accept", env).ok).toBe(false);
  });
});
