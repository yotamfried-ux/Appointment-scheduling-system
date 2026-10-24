import { deflateRawSync } from "node:zlib";

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null | undefined)[][];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip invalid XML control chars except tab, CR, LF
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function sanitizeCellText(raw: string): string {
  if (/^[=+\-@\t\r]/.test(raw)) {
    return `'${raw}`;
  }
  return raw;
}

function colLetter(colIdx0: number): string {
  let n = colIdx0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sanitizeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
  return cleaned || `גיליון ${index + 1}`;
}

function buildWorksheetXml(sheet: XlsxSheet): string {
  const colWidths = sheet.headers.map((h, colIdx) => {
    let maxLen = h.length;
    for (let r = 0; r < Math.min(sheet.rows.length, 500); r++) {
      const v = sheet.rows[r]?.[colIdx];
      const str = v == null ? "" : String(v);
      if (str.length > maxLen) maxLen = str.length;
    }
    return Math.min(48, Math.max(12, maxLen + 5));
  });

  const colsXml =
    colWidths.length > 0
      ? `<cols>${colWidths
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
          .join("")}</cols>`
      : "";

  const rowsXml: string[] = [];

  // Row 1: Header row (style s="1")
  const headerCells = sheet.headers
    .map((h, cIdx) => {
      const ref = `${colLetter(cIdx)}1`;
      return `<c r="${ref}" s="1" t="inlineStr"><is><t>${escapeXml(sanitizeCellText(h))}</t></is></c>`;
    })
    .join("");
  rowsXml.push(`<row r="1" ht="24" customHeight="1">${headerCells}</row>`);

  // Data rows (style s="2" for text, s="3" for numbers)
  for (let rIdx = 0; rIdx < sheet.rows.length; rIdx++) {
    const rowNum = rIdx + 2;
    const row = sheet.rows[rIdx];
    const cells: string[] = [];
    for (let cIdx = 0; cIdx < sheet.headers.length; cIdx++) {
      const val = row[cIdx];
      if (val === null || val === undefined || val === "") continue;
      const ref = `${colLetter(cIdx)}${rowNum}`;
      if (typeof val === "number" && Number.isFinite(val)) {
        cells.push(`<c r="${ref}" s="3"><v>${val}</v></c>`);
      } else if (typeof val === "boolean") {
        const text = val ? "כן" : "לא";
        cells.push(`<c r="${ref}" s="2" t="inlineStr"><is><t>${text}</t></is></c>`);
      } else {
        const text = escapeXml(sanitizeCellText(String(val)));
        cells.push(`<c r="${ref}" s="2" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`);
      }
    }
    rowsXml.push(`<row r="${rowNum}" ht="20" customHeight="1">${cells.join("")}</row>`);
  }

  const lastCol = colLetter(Math.max(0, sheet.headers.length - 1));
  const lastRow = Math.max(1, sheet.rows.length + 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCol}${lastRow}"/>
  <sheetViews>
    <sheetView rightToLeft="1" tabSelected="1" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  ${colsXml}
  <sheetData>${rowsXml.join("")}</sheetData>
</worksheet>`;
}

function packZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const uncompressedSize = entry.data.length;
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data);
    const compressedSize = compressed.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, 8, true); // Compression method: deflate (8)
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0x5421, true); // Mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressedSize, true);
    lv.setUint32(22, uncompressedSize, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory file header signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 8, true); // Deflate
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressedSize, true);
    cv.setUint32(24, uncompressedSize, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // End of central directory signature
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const p of centralParts) {
    out.set(p, pos);
    pos += p.length;
  }
  out.set(eocd, pos);
  return out;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Builds a clean RTL OpenXML (.xlsx) workbook buffer from one or more sheets. */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const enc = new TextEncoder();
  const safeSheets = (sheets.length > 0 ? sheets : [{ name: "נתונים", headers: ["נתונים"], rows: [] }]).map((s, i) => ({
    ...s,
    name: sanitizeSheetName(s.name, i),
  }));

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${safeSheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("\n  ")}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView firstSheet="0" activeTab="0"/>
  </bookViews>
  <sheets>
    ${safeSheets
      .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("\n    ")}
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${safeSheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("\n  ")}
  <Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF1C1B18"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF1C1B18"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3EFE6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE3DDD2"/></left>
      <right style="thin"><color rgb="FFE3DDD2"/></right>
      <top style="thin"><color rgb="FFE3DDD2"/></top>
      <bottom style="medium"><color rgb="FFC8C0B3"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center" readingOrder="2"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
      <alignment horizontal="right" vertical="center" readingOrder="2"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>`;

  const entries: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypesXml) },
    { name: "_rels/.rels", data: enc.encode(rootRelsXml) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(workbookRelsXml) },
    { name: "xl/styles.xml", data: enc.encode(stylesXml) },
    ...safeSheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(buildWorksheetXml(s)),
    })),
  ];

  return packZip(entries);
}
