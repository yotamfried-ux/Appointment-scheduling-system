// CSV for Excel (RPT-02/03): UTF-8 with a BOM so Hebrew opens correctly, CRLF rows, every field quoted, and formula injection neutralised.
export const BOM = "﻿";

/** A cell that starts with = + - @ (or a tab / carriage return) would be run as a formula by spreadsheet programs: prefix an apostrophe (OWASP). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : '""'; // real numbers are never formulas
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const csvRow = (cells: unknown[]) => `${cells.map(csvCell).join(",")}\r\n`;
