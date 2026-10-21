import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "@/lib/security/csp";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ");

describe("buildCsp (docs/05 §5.5)", () => {
  const nonce = "abc123";

  it("is default-deny with a per-request nonce and strict-dynamic", () => {
    const csp = buildCsp({ nonce });
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
  });

  it("never allows unsafe-eval or unsafe-inline for scripts in production", () => {
    const script = directive(buildCsp({ nonce, isDev: false }), "script-src")!;
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
  });

  it("only relaxes script-src with unsafe-eval in development", () => {
    expect(directive(buildCsp({ nonce, isDev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("limits unsafe-inline to style *attributes*, not <style> elements", () => {
    const csp = buildCsp({ nonce });
    expect(directive(csp, "style-src")).not.toContain("'unsafe-inline'");
    expect(directive(csp, "style-src-attr")).toEqual(["'unsafe-inline'"]);
  });

  it("allows only the configured Supabase origin (http + websocket) for connections", () => {
    const connect = directive(buildCsp({ nonce, supabaseUrl: "https://proj.supabase.co" }), "connect-src")!;
    expect(connect).toEqual(["'self'", "https://proj.supabase.co", "wss://proj.supabase.co"]);
    expect(connect.join(" ")).not.toContain("*");
  });

  it("upgrades insecure requests only outside development", () => {
    expect(buildCsp({ nonce, isDev: false })).toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce, isDev: true })).not.toContain("upgrade-insecure-requests");
  });

  it("generates unique, unguessable-looking nonces", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
