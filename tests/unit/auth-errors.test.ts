import { describe, expect, it } from "vitest";
import { authErrorKey, isExistingAccount } from "@/lib/auth/errors";

describe("sign-up does not reveal which addresses are registered", () => {
  it("recognises Supabase's already-registered error", () => {
    expect(isExistingAccount({ code: "user_already_exists", status: 422, message: "User already registered" })).toBe(true);
  });
  it("does not swallow other errors", () => {
    for (const e of [{ code: "weak_password" }, { code: "over_email_send_rate_limit" }, new Error("fetch failed"), null, undefined, "user_already_exists"]) expect(isExistingAccount(e)).toBe(false);
    expect(authErrorKey({ code: "weak_password" })).toBe("weak_password");
  });
});
