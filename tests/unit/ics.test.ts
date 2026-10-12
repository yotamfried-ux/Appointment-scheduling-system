import { describe, expect, it } from "vitest";
import { buildIcs, fold, icsText } from "@/modules/calendar/ics";

const base = {
  uid: "abc-123@tori.example",
  sequence: 5,
  stamp: new Date("2026-10-12T08:30:00Z"),
  start: new Date("2026-10-20T07:00:00Z"),
  end: new Date("2026-10-20T07:30:00Z"),
  summary: "תספורת · מספרה",
  status: "CONFIRMED" as const,
};
const lines = (s: string) => s.split("\r\n");

describe("ICS (CAL-05)", () => {
  it("is a well-formed calendar with CRLF line ends, UTC times, a stable UID and the given SEQUENCE", () => {
    const out = buildIcs(base);
    expect(out.endsWith("\r\n")).toBe(true);
    expect(out).not.toMatch(/[^\r]\n/); // every newline is CRLF
    const l = lines(out);
    expect(l[0]).toBe("BEGIN:VCALENDAR");
    expect(l).toContain("VERSION:2.0");
    expect(l).toContain("UID:abc-123@tori.example");
    expect(l).toContain("SEQUENCE:5");
    expect(l).toContain("DTSTART:20261020T070000Z");
    expect(l).toContain("DTEND:20261020T073000Z");
    expect(l).toContain("DTSTAMP:20261012T083000Z");
    expect(l).toContain("STATUS:CONFIRMED");
    expect(l.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(1);
    expect(l.at(-2)).toBe("END:VCALENDAR");
  });
  it("is deterministic: same input, same bytes (so repeated downloads import as the same event)", () => {
    expect(buildIcs(base)).toBe(buildIcs({ ...base }));
  });
  it("a changed appointment keeps the UID and raises the SEQUENCE", () => {
    const a = buildIcs(base);
    const b = buildIcs({ ...base, sequence: 6, start: new Date("2026-10-20T08:00:00Z"), end: new Date("2026-10-20T08:30:00Z") });
    expect(lines(a).find((x) => x.startsWith("UID:"))).toBe(lines(b).find((x) => x.startsWith("UID:")));
    expect(lines(b)).toContain("SEQUENCE:6");
  });
  it("escapes TEXT and cannot be made to start a new line or property (SEC-08)", () => {
    const BS = String.fromCharCode(92); // a single backslash, spelled out so no string-escape typo can hide in this test
    expect(icsText("a,b;c" + BS + "d")).toBe("a" + BS + ",b" + BS + ";c" + BS + BS + "d");
    // property: in the output every semicolon and comma is preceded by a backslash, and every backslash starts a valid escape
    for (const raw of ["x;y", ";;", "a,b,c", "mix;of,all" + BS + ";", BS + BS + ";"]) {
      const out = icsText(raw);
      expect(out.replace(/\\[\\;,n]/g, "")).not.toMatch(/[\\;,]/);
    }
    expect(icsText("line1\nline2\r\nline3")).toBe("line1\\nline2\\nline3");
    const evil = buildIcs({ ...base, summary: "x\r\nATTENDEE:mailto:evil@example.com\r\nBEGIN:VALARM", location: "y\nORGANIZER:mailto:evil@example.com" });
    const l = lines(evil);
    expect(l.some((x) => x.startsWith("ATTENDEE"))).toBe(false);
    expect(l.some((x) => x.startsWith("ORGANIZER"))).toBe(false);
    expect(l.filter((x) => x === "BEGIN:VALARM")).toHaveLength(0);
    expect(icsText("a\u0000b\u0007c")).toBe("abc");
  });
  it("folds long lines at 75 octets without splitting a character, and unfolding restores the text", () => {
    const long = "ש".repeat(120) + " " + "x".repeat(200); // Hebrew letters are 2 octets each
    const out = buildIcs({ ...base, description: long });
    for (const l of lines(out)) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const unfolded = out.replace(/\r\n /g, "");
    expect(unfolded).toContain(`DESCRIPTION:${long}`);
    expect(fold("short")).toBe("short");
    expect(fold("a".repeat(75))).toBe("a".repeat(75));
    expect(fold("a".repeat(76)).split("\r\n")).toHaveLength(2);
  });
  it("TENTATIVE for a request still awaiting approval; an optional reminder; optional fields omitted", () => {
    const l = lines(buildIcs({ ...base, status: "TENTATIVE", alarmMinutes: 60 }));
    expect(l).toContain("STATUS:TENTATIVE");
    expect(l).toContain("TRIGGER:-PT60M");
    expect(l.some((x) => x.startsWith("LOCATION"))).toBe(false);
    expect(lines(buildIcs(base)).some((x) => x.startsWith("BEGIN:VALARM"))).toBe(false);
  });
  it("refuses an event that ends before it starts", () => {
    expect(() => buildIcs({ ...base, end: base.start })).toThrow();
  });
});
