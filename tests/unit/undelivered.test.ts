import { describe, expect, it } from "vitest";
import he from "@/messages/he.json";
import { FailureCode } from "@/lib/api/contracts";
import { kindKey, reasonKey, splitUndelivered } from "@/lib/owner/undelivered";

const agenda = he.owner.agenda as unknown as { kind: Record<string, string>; reason: Record<string, string> };

describe("undelivered messages: wording for the owner", () => {
  it("every failure code has a Hebrew reason, and the reasons are plain words", () => {
    for (const code of FailureCode.options) {
      expect(agenda.reason[reasonKey(code)], code).toMatch(/[֐-׿]/);
    }
    expect(agenda.reason.provider_rejected).toContain("דחה");
    expect(agenda.reason.bounced).toContain("כתובת המייל");
    expect(agenda.reason.no_email).toBe("אין כתובת מייל, אין מה לשלוח");
    expect(agenda.reason.rate_limited).toContain("הגביל");
  });
  it("an unknown code reads as unknown, not as a raw key", () => {
    expect(reasonKey("something_new")).toBe("unknown");
    expect(agenda.reason[reasonKey("something_new")]).toBe("סיבה לא ידועה");
  });
  it("customer message kinds are named in Hebrew; anything else is a plain message", () => {
    expect(agenda.kind[kindKey("booking_confirmed")]).toBe("אישור הזמנה");
    expect(agenda.kind[kindKey("reminder")]).toBe("תזכורת");
    expect(agenda.kind[kindKey("waitlist_offer")]).toBe("הצעה מרשימת המתנה");
    expect(agenda.kind[kindKey("owner_digest")]).toBe("הודעה");
  });
  it("no_email is separated from the failures the owner must act on", () => {
    const items = [{ code: "provider_rejected" }, { code: "no_email" }, { code: "bounced" }];
    const { failed, noEmail } = splitUndelivered(items);
    expect(failed.map((i) => i.code)).toEqual(["provider_rejected", "bounced"]);
    expect(noEmail.map((i) => i.code)).toEqual(["no_email"]);
  });
});
