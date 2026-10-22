import { describe, expect, it } from "vitest";
import { sessionIsLive } from "@/lib/auth/live-session";

const client = (r: { data?: { user: unknown } | null; error?: { status?: number } | null }) => ({ auth: { getUser: async () => ({ data: r.data ?? { user: null }, error: r.error ?? null }) } }) as never;

describe("sessionIsLive: a logged-out or revoked session must not keep working until its token expires", () => {
  it("is live when the Auth server returns the user", async () => {
    expect(await sessionIsLive(client({ data: { user: { id: "u" } } }))).toBe(true);
  });
  it("is not live when the Auth server says the session is gone (4xx)", async () => {
    for (const status of [400, 401, 403]) expect(await sessionIsLive(client({ error: { status } }))).toBe(false);
  });
  it("trusts the signed token when the Auth server cannot be reached (no status / 5xx)", async () => {
    expect(await sessionIsLive(client({ error: { status: undefined } }))).toBe(true);
    expect(await sessionIsLive(client({ error: { status: 503 } }))).toBe(true);
  });
});
