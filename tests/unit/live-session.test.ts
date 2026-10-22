import { describe, expect, it } from "vitest";
import { checkSession } from "@/lib/auth/live-session";

const client = (r: { user?: { factors?: { status: string }[] } | null }) => ({ auth: { getUser: async () => ({ data: { user: r.user ?? null }, error: null }) } }) as never;
const verified = { factors: [{ status: "verified" }] };

describe("checkSession: the Auth server decides, not the cookie", () => {
  it("a logged-out or revoked session (no user) is not live, and neither is one the server cannot be asked about", async () => {
    expect(await checkSession(client({ user: null }), { aal: "aal1" })).toEqual({ live: false, secondFactor: false });
  });
  it("an account without a verified factor needs no second factor", async () => {
    expect(await checkSession(client({ user: {} }), { aal: "aal1" })).toEqual({ live: true, secondFactor: true });
    expect(await checkSession(client({ user: { factors: [{ status: "unverified" }] } }), { aal: "aal1" })).toEqual({ live: true, secondFactor: true });
  });
  it("an account with a verified factor needs a session that passed it (aal2 in the signed token)", async () => {
    expect(await checkSession(client({ user: verified }), { aal: "aal1" })).toEqual({ live: true, secondFactor: false });
    expect(await checkSession(client({ user: verified }), { aal: "aal2" })).toEqual({ live: true, secondFactor: true });
    expect(await checkSession(client({ user: verified }), undefined)).toEqual({ live: true, secondFactor: false });
  });
  it("editing the factor list in the cookie changes nothing: only the server's list counts", async () => {
    // the cookie (what getSession would show) says "no factors"; the server says there is one; the token is aal1
    expect((await checkSession(client({ user: verified }), { aal: "aal1" })).secondFactor).toBe(false);
  });
});
