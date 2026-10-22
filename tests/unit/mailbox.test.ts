import { describe, expect, it } from "vitest";
import { mailboxKey } from "@/lib/mailbox";

describe("mailboxKey: one inbox, one key", () => {
  it("ignores case, spaces and the +tag", () => {
    expect(mailboxKey("  Dana+one@Example.com ")).toBe("dana@example.com");
    expect(mailboxKey("dana+two@example.com")).toBe(mailboxKey("dana+three@example.com"));
  });
  it("treats Gmail's dots and the googlemail.com domain as the same inbox", () => {
    expect(mailboxKey("d.a.n.a@gmail.com")).toBe("dana@gmail.com");
    expect(mailboxKey("dana@googlemail.com")).toBe("dana@gmail.com");
  });
  it("keeps dots elsewhere, where they do matter", () => {
    expect(mailboxKey("d.ana@example.com")).not.toBe(mailboxKey("dana@example.com"));
  });
  it("does not choke on odd input", () => {
    expect(mailboxKey("no-at-sign")).toBe("no-at-sign");
    expect(mailboxKey("@x.com")).toBe("@x.com");
    expect(mailboxKey("+@x.com")).toBe("@x.com");
  });
});
