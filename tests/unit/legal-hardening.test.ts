import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import he from "@/messages/he.json";
import { ACCEPTED_DOCS, LEGAL } from "@/lib/legal/config";
import { A11Y, COOKIES_ESSENTIAL, PRIVACY, TERMS, type LegalSection } from "@/lib/legal/content";

const flattenText = (sections: LegalSection[]) =>
  sections.map((s) => `${s.title} ${s.body.flat().join(" ")}`).join("\n");

const ROOT = process.cwd();
const readDoc = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("legal hardening invariants (PR #80 / LR-01..LR-18)", () => {
  it("keeps LEGAL versions in YYYY-MM-DD format (DB constraint) and triggers current version acceptance", () => {
    const versionPattern = /^\d{4}-\d{2}-\d{2}(\.\d+)?$/;
    expect(LEGAL.terms.version).toMatch(versionPattern);
    expect(LEGAL.privacy.version).toMatch(versionPattern);
    expect(LEGAL.cookies.version).toMatch(versionPattern);
    expect(LEGAL.accessibility.version).toMatch(versionPattern);
    expect(LEGAL.terms.version).toBe("2026-11-14");
    expect(LEGAL.privacy.version).toBe("2026-11-14");
    expect(ACCEPTED_DOCS).toEqual(["terms", "privacy"]);
  });

  it("separates operator legal name (D2R) from brand (תורים) without inventing registration numbers or 'בע\"מ' claims (LR-01)", () => {
    expect(LEGAL.operator.name).toBe("D2R");
    expect(LEGAL.operator.brand).toBe("תורים");
    const combined = `${flattenText(PRIVACY)}\n${flattenText(TERMS)}`;
    expect(combined).not.toContain("טרם נבדק משפטית");
    expect(combined).not.toContain("D2R בע\"מ");
    expect(he.legal.operator.registrationPending).toContain("אינו פועל כחברה בע\"מ");
  });

  it("preserves E2E-critical anchor indices, substrings, and counts across Privacy, Cookies, and A11Y", () => {
    // tests/e2e/legal-calendar.spec.ts clicks TOC link nth(2) on /privacy and asserts /#why$/
    expect(PRIVACY[0]?.id).toBe("who");
    expect(PRIVACY[1]?.id).toBe("what");
    expect(PRIVACY[2]?.id).toBe("why");

    // tests/e2e/legal-calendar.spec.ts checks exact list item count on /cookies
    expect(COOKIES_ESSENTIAL).toHaveLength(4);

    // tests/e2e/legal-calendar.spec.ts asserts this exact phrase on /accessibility
    expect(flattenText(A11Y)).toContain("טרם בוצע ביקורת נגישות חיצונית");
  });

  it("PRIVACY covers dual Controller/Processor roles, statutory Section 11 notice, sensitive-data prohibition, EU transfers, accurate retention, and DSAR rights", () => {
    const text = flattenText(PRIVACY);
    expect(text).toContain("בעל השליטה במאגר המידע");
    expect(text).toContain("מחזיק ומעבד מידע");
    expect(text).toContain("סעיף 11 לחוק הגנת הפרטיות");
    expect(text).toContain("חובה או רשות והשלכת אי-מסירה");
    expect(text).toContain("איסור מוחלט על הזנת מידע רפואי");
    expect(text).toContain("סעיף 30א לחוק התקשורת");
    expect(text).toContain("eu-central-1");
    expect(text).toContain("fra1");
    expect(text).toContain("3 שנים");
    expect(text).toContain("90 יום");
    expect(text).toContain("14 ימים");
    expect(text).toContain("זכות עיון");
    expect(text).toContain("זכות לתיקון מידע");
    expect(text).toContain("זכות למחיקה");
    // Must never make impossible backup erasure or 100% security claims
    expect(text).toContain("איננו מתחייבים למחיקה מיידית מתוך גיבויים אוטומטיים");
    expect(text).toContain("אף מערכת דיגיטלית אינה חסינה לחלוטין");
  });

  it("TERMS implements Calmark-grade SaaS clauses, embedded Business DPA, No-Show/intermediary rules, and Standard Contracts Law balance", () => {
    const ids = TERMS.map((s) => s.id);
    expect(ids).toEqual([
      "about",
      "service",
      "account",
      "customers",
      "dpa",
      "sensitive-data",
      "customer-terms",
      "subscription",
      "refunds",
      "use",
      "ip",
      "availability",
      "termination",
      "liability",
      "indemnity",
      "law",
      "updates",
    ]);

    const text = flattenText(TERMS);
    expect(text).toContain("מתווך טכנולוגי בלבד");
    expect(text).toContain("Data Processing Addendum — DPA");
    expect(text).toContain("אירוע אבטחה חמור");
    expect(text).toContain("No-Show");
    expect(text).toContain("חוק החוזים האחידים");
    expect(text).toContain("רשלנות חמורה");
    expect(text).toContain("חוק הגנת הצרכן");
    expect(text).toContain("דיווח על עסק זה");
    expect(text).toContain("איסור התחזות");
    // Must not guarantee 100% availability
    expect(text).toContain("איננו מתחייבים לזמינות של 100%");
  });

  it("includes Section 11 notice & sensitive-data warnings at UI collection points in messages/he.json", () => {
    expect(he.legal.termsAccept.notice).toContain("סעיף 11 לחוק הגנת הפרטיות");
    expect(he.legal.termsAccept.notice).toContain("נא לא להזין מידע רפואי רגיש");
    expect(he.legal.accept.signupNote).toContain("<terms>");
    expect(he.legal.accept.signupNote).toContain("<privacy>");
    expect(he.legal.accept.signupNote).toContain("סעיף 11 לחוק הגנת הפרטיות");
    expect(he.owner.manual.noteHint).toContain("מידע רפואי");
    expect(he.customers.detail.notesHint).toContain("מידע רפואי");
  });

  it("reconciles docs/legal/* with Frankfurt production, 90-day notification retention, and 2026-11-14 versions (LR-17)", () => {
    const processors = readDoc("docs/legal/processors-and-transfers.md");
    expect(processors).toContain("eu-central-1");
    expect(processors).toContain("abhadytskhgwkrlmceew");
    expect(processors).toContain("fra1");
    expect(processors).not.toContain("production region: unknown");

    const retention = readDoc("docs/legal/retention-deletion-matrix.md");
    expect(retention).toContain("20261040000000_notification_log_retention.sql");
    expect(retention).toContain("90 days");

    const dataMap = readDoc("docs/legal/data-map.md");
    expect(dataMap).toContain("2026-11-14");
    expect(dataMap).toContain("20261047000000");

    const qualification = readDoc("docs/legal/legal-qualification.md");
    expect(qualification).toContain("2026-11-14");
    expect(qualification).toContain("yotam.fried@gmail.com");
  });
});
