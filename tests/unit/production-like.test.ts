import { afterEach, describe, expect, it, vi } from "vitest";
import { isProductionLike } from "@/lib/env";
import { readJson } from "@/lib/api/http";

afterEach(() => vi.unstubAllEnvs());

describe("production-like lockdown", () => {
  it("is on for a Vercel production deploy", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isProductionLike()).toBe(true);
  });
  it("is on for any NODE_ENV=production process even without VERCEL_ENV (self-hosted next start)", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_NON_PRODUCTION_DEFAULTS", "");
    expect(isProductionLike()).toBe(true);
  });
  it("the E2E server opts out explicitly, but a Vercel production deploy cannot", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_NON_PRODUCTION_DEFAULTS", "1");
    vi.stubEnv("VERCEL_ENV", "");
    expect(isProductionLike()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isProductionLike()).toBe(true);
  });
  it("is off in dev and test", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(isProductionLike()).toBe(false);
  });
});

describe("JSON body cap", () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers });
  it("parses a normal body", async () => expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 }));
  it("rejects an oversized body even without a Content-Length", async () => {
    await expect(readJson(post(JSON.stringify({ x: "a".repeat(70_000) })))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("rejects a declared oversized body before reading it", async () => {
    await expect(readJson(post("{}", { "content-length": "999999" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("still reports malformed JSON", async () => {
    await expect(readJson(post("{nope"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
