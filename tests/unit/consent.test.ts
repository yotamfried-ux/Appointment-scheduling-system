import { describe, expect, it } from "vitest";
import { OPTIONAL_CATEGORIES, allowed, needsDecision, parseConsent, readConsentCookie, serializeConsent, type OptionalCategory } from "@/lib/consent";

const analytics: OptionalCategory = { id: "analytics", label: "אנליטיקה", description: "מדידת שימוש" };
const ads: OptionalCategory = { id: "ads", label: "פרסום", description: "פרסונליזציה" };

describe("consent gate (CMP-01)", () => {
  it("today there is nothing optional: no banner, and nothing is ever allowed", () => {
    expect(OPTIONAL_CATEGORIES).toHaveLength(0);
    expect(needsDecision(null)).toBe(false);
    expect(allowed("analytics", null)).toBe(false);
    expect(allowed("analytics", parseConsent(serializeConsent({ analytics: true })))).toBe(false); // an unregistered category is never allowed, whatever the cookie says
  });
  it("before a decision an optional category is NOT allowed and the banner is needed", () => {
    expect(allowed("analytics", null, [analytics])).toBe(false);
    expect(needsDecision(null, [analytics])).toBe(true);
  });
  it("only an explicit yes allows; a no or a missing answer does not", () => {
    const s = parseConsent(serializeConsent({ analytics: true, ads: false }));
    expect(allowed("analytics", s, [analytics, ads])).toBe(true);
    expect(allowed("ads", s, [analytics, ads])).toBe(false);
    expect(allowed("other", s, [analytics, ads])).toBe(false);
  });
  it("a newly added category asks again; answered ones are remembered", () => {
    const s = parseConsent(serializeConsent({ analytics: false }));
    expect(needsDecision(s, [analytics])).toBe(false);
    expect(needsDecision(s, [analytics, ads])).toBe(true);
  });
  it("garbage cookies are treated as no decision, never as consent", () => {
    for (const raw of ["", "%", "not-json", encodeURIComponent("{}"), encodeURIComponent('{"v":2,"at":1,"choices":{"analytics":true}}'), encodeURIComponent('{"v":1,"at":"x","choices":{}}'), encodeURIComponent('{"v":1,"at":1,"choices":{"analytics":"yes"}}')]) {
      const s = parseConsent(raw);
      expect(allowed("analytics", s, [analytics]), raw).toBe(false);
    }
  });
  it("reads its own cookie out of a cookie header", () => {
    const header = `a=1; tori_consent=${serializeConsent({ analytics: true })}; b=2`;
    expect(allowed("analytics", readConsentCookie(header), [analytics])).toBe(true);
    expect(readConsentCookie("a=1; b=2")).toBeNull();
  });
});
