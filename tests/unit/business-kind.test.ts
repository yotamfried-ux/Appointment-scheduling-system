import { describe, expect, it } from "vitest";
import { KIND_IDS, getKind, kindFromParam, type BusinessKindId } from "@/modules/tenancy/business-kind";

const VOCAB_KEYS = [
  "appointment", "appointments", "customer", "customers", "service", "services", "provider",
  "pickService", "pickServiceHint", "bookCta", "doneTitle", "businessNoun",
] as const;

describe("business kinds (adaptability across business types)", () => {
  it("covers the seven supported kinds", () => {
    expect([...KIND_IDS].sort()).toEqual(["barber", "beauty", "clinic", "nails", "other", "teacher", "trainer"]);
  });

  it("names the professions the way their people call themselves", () => {
    expect(getKind("teacher").label).toBe("מורה פרטי/ת");
    expect(getKind("nails").label).toBe("מניקוריסט/ית");
    expect(getKind("nails").vocab.appointment).toBe("תור");
    expect(getKind("nails").presets.map((p) => p.name)).toEqual(expect.arrayContaining(["לק ג׳ל", "הסרת ג׳ל"]));
  });

  it.each(KIND_IDS)("%s defines complete Hebrew vocabulary", (id) => {
    const k = getKind(id);
    for (const key of VOCAB_KEYS) {
      expect(k.vocab[key], `${id}.vocab.${key}`).toMatch(/[֐-׿]/); // contains Hebrew
    }
  });

  it("uses different words where the domain differs (not one generic vocabulary)", () => {
    const words = new Set(KIND_IDS.map((id) => getKind(id).vocab.customer));
    expect(words.size).toBeGreaterThanOrEqual(4);
    expect(getKind("clinic").vocab.customer).toContain("מטופל");
    expect(getKind("teacher").vocab.customer).toContain("תלמיד");
    expect(getKind("trainer").vocab.appointment).toBe("אימון");
    expect(getKind("teacher").vocab.appointment).toBe("שיעור");
  });

  it.each(KIND_IDS)("%s has sane scheduling defaults", (id) => {
    const d = getKind(id).defaults;
    expect(d.slotStepMinutes).toBeGreaterThanOrEqual(15);
    expect(d.slotStepMinutes).toBeLessThanOrEqual(60);
    expect(d.bufferMinutes).toBeGreaterThanOrEqual(0);
    expect(d.bufferMinutes).toBeLessThanOrEqual(30);
    expect(d.cancelUntilHours).toBeGreaterThanOrEqual(1);
  });

  it.each(KIND_IDS)("%s presets are valid, unique and bounded", (id) => {
    const p = getKind(id).presets;
    expect(p.length).toBeLessThanOrEqual(6);
    expect(new Set(p.map((x) => x.name)).size).toBe(p.length);
    for (const x of p) {
      expect(x.durationMinutes).toBeGreaterThan(0);
      expect(x.priceNis).toBeGreaterThan(0);
      expect(x.name.length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(KIND_IDS)("%s opening-hour windows are valid (ordered, non-overlapping, within a day)", (id) => {
    const hours = getKind(id).hours;
    expect(hours).toHaveLength(7);
    for (const windows of hours) {
      let prevEnd = 0;
      for (const w of windows) {
        expect(w.from).toBeGreaterThanOrEqual(prevEnd);
        expect(w.to).toBeGreaterThan(w.from);
        expect(w.to).toBeLessThanOrEqual(24 * 60);
        prevEnd = w.to;
      }
    }
    expect(hours.some((w) => w.length > 0)).toBe(true);
  });

  it("models genuinely different working patterns (AVL-01: more than one window per day)", () => {
    const multi = (id: BusinessKindId) => getKind(id).hours.some((w) => w.length > 1);
    expect(multi("trainer")).toBe(true); // early morning + evening
    expect(multi("barber")).toBe(false);
    const teacherStart = Math.min(...getKind("teacher").hours.flatMap((w) => w.map((x) => x.from)));
    expect(teacherStart).toBeGreaterThanOrEqual(13 * 60); // afternoons only
  });

  it("group sessions are only configured where they make sense", () => {
    for (const id of KIND_IDS) {
      const g = getKind(id).group;
      if (g.supported) expect(g.defaultCapacity).toBeGreaterThan(1);
      else expect(g.defaultCapacity).toBe(1);
    }
    expect(getKind("trainer").group.supported).toBe(true);
    expect(getKind("teacher").group.supported).toBe(true);
    expect(getKind("barber").group.supported).toBe(false);
  });

  it("location modes: customer-site and online only where relevant", () => {
    expect(getKind("barber").locations).toEqual(["business"]);
    expect(getKind("trainer").locations).toEqual(expect.arrayContaining(["business", "customer", "online"]));
    expect(getKind("clinic").locations).toEqual(expect.arrayContaining(["business", "online"]));
  });

  describe("privacy (docs/05 §2: health-related kinds)", () => {
    it("clinic, beauty and nails are marked sensitive and minimise what leaves the system", () => {
      for (const id of ["clinic", "beauty", "nails"] as const) {
        const p = getKind(id).privacy;
        expect(p.sensitive, id).toBe(true);
        expect(p.hideServiceNameInMessages, id).toBe(true);
        expect(p.allowFreeTextNotesInMessages, id).toBe(false);
      }
    });

    it("no kind ever sends free-text notes or intake answers in outbound messages", () => {
      for (const id of KIND_IDS) {
        expect(getKind(id).privacy.allowFreeTextNotesInMessages, id).toBe(false);
        for (const f of getKind(id).intake) expect(f.inMessages, `${id}.${f.id}`).toBe(false);
      }
    });

    it("no business kind collects sensitive intake fields (owner decision 2026-10-20; reopen with counsel before adding any)", () => {
      for (const id of KIND_IDS) {
        expect(getKind(id).intake.filter((x) => x.sensitive), id).toEqual([]);
      }
    });
  });

  it("clinic requires approval for new customers by default; barber does not", () => {
    expect(getKind("clinic").defaults.requireApproval).toBe(true);
    expect(getKind("barber").defaults.requireApproval).toBe(false);
  });

  describe("kindFromParam is safe against hostile input", () => {
    it.each([undefined, null, "", "nope", "__proto__", "constructor", "toString", "../clinic", "CLINIC", ["clinic"] as unknown as string])("%j falls back to the default", (v) => {
      expect(kindFromParam(v as string | null | undefined)).toBe("barber");
    });
    it("accepts valid ids", () => {
      for (const id of KIND_IDS) expect(kindFromParam(id)).toBe(id);
    });
  });
});
