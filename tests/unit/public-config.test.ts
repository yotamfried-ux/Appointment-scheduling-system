import { describe, expect, it } from "vitest";
import { missingPublicConfig } from "@/platform/public-config";

describe("missingPublicConfig (readiness covers what the pages need)", () => {
  it("is empty when both are set", () => expect(missingPublicConfig({ url: "https://x.supabase.co", key: "sb_publishable_x" })).toEqual([]));
  it("names the publishable key when only it is missing (the cloud incident)", () => expect(missingPublicConfig({ url: "https://x.supabase.co" })).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]));
  it("names both, treats blank as missing, and never returns a value", () => {
    const r = missingPublicConfig({ url: "  ", key: "" });
    expect(r).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    expect(JSON.stringify(missingPublicConfig({ url: "https://secret-host.supabase.co" }))).not.toContain("secret-host");
  });
});

import { missingServerConfig } from "@/platform/public-config";
describe("missingServerConfig", () => {
  it("a booking cannot be signed without a 32+ character secret: not ready, by name only", () => {
    expect(missingServerConfig({})).toEqual(["BOOKING_TOKEN_SECRET"]);
    expect(missingServerConfig({ bookingTokenSecret: "short" })).toEqual(["BOOKING_TOKEN_SECRET"]);
    expect(missingServerConfig({ bookingTokenSecret: "x".repeat(32) })).toEqual([]);
  });
});
