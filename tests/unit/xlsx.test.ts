import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, XLSX_MIME } from "@/modules/reports/xlsx";

function unzipEntries(zip: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let pos = 0;
  while (pos + 4 <= zip.length) {
    const sig = dv.getUint32(pos, true);
    if (sig !== 0x04034b50) break; // reached central directory
    const compressedSize = dv.getUint32(pos + 18, true);
    const nameLen = dv.getUint16(pos + 26, true);
    const extraLen = dv.getUint16(pos + 28, true);
    const name = new TextDecoder().decode(zip.subarray(pos + 30, pos + 30 + nameLen));
    const dataStart = pos + 30 + nameLen + extraLen;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    const inflated = inflateRawSync(compressed);
    out.set(name, new TextDecoder().decode(inflated));
    pos = dataStart + compressedSize;
  }
  return out;
}

describe("buildXlsx (RTL Excel export)", () => {
  it("packs a valid OpenXML .xlsx zip with RTL sheet views, Hebrew headers, numbers, and formula sanitization", () => {
    const buf = buildXlsx([
      {
        name: "תורים",
        headers: ["אסמכתא", "תאריך", "שעה", "שירות", "סטטוס", "מחיר (₪)", "לקוח", "טלפון", "מקור"],
        rows: [
          ["TR-1001", "2026-10-25", "10:30", "תספורת גברים", "מאושר", 80, "נועם לוי", "+972501234567", "הזמנה באתר"],
          ["TR-1002", "2026-10-25", "11:00", "עיצוב זקן", "הושלם", 50, "=HYPERLINK(\"http://evil.example\",\"x\")", "+972509998877", "יומן העסק"],
        ],
      },
      {
        name: "לקוחות",
        headers: ["שם", "פעיל"],
        rows: [["נועם לוי", true]],
      },
    ]);

    expect(XLSX_MIME).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'

    const files = unzipEntries(buf);
    expect(files.has("[Content_Types].xml")).toBe(true);
    expect(files.has("xl/workbook.xml")).toBe(true);
    expect(files.has("xl/styles.xml")).toBe(true);
    expect(files.has("xl/worksheets/sheet1.xml")).toBe(true);
    expect(files.has("xl/worksheets/sheet2.xml")).toBe(true);

    const wb = files.get("xl/workbook.xml")!;
    expect(wb).toContain('name="תורים"');
    expect(wb).toContain('name="לקוחות"');

    const sheet1 = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet1).toContain('rightToLeft="1"');
    expect(sheet1).toContain("אסמכתא");
    expect(sheet1).toContain("הזמנה באתר");
    expect(sheet1).toContain("יומן העסק");
    expect(sheet1).toContain("<v>80</v>");
    // Formula injection neutralized with leading apostrophe (&apos;=HYPERLINK...)
    expect(sheet1).toContain("&apos;=HYPERLINK");

    const sheet2 = files.get("xl/worksheets/sheet2.xml")!;
    expect(sheet2).toContain("כן");
  });
});
