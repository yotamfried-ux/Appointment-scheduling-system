import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";

describe("safeNext (open-redirect guard)", () => {
  it.each(["/dashboard", "/dashboard/settings?tab=1", "/customers"])("keeps %s", (v) => expect(safeNext(v)).toBe(v));
  it.each(["//evil.com", "/\\evil.com", "/%09/evil.com", "/%0a/evil.com", "/%2f/evil.com", "/%5cevil.com", "https://evil.com", "javascript:alert(1)", "", null, "/\t/evil.com", "/%E0%A4%A"])(
    "rejects %s",
    (v) => expect(safeNext(v as string | null)).toBe("/dashboard"),
  );
});
