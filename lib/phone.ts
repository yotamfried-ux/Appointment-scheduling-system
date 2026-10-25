import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** Normalises an Israeli (or international) phone to E.164, or null if invalid (ACC-03). */
export function normalizePhone(input: string, defaultCountry: "IL" = "IL"): string | null {
  const p = parsePhoneNumberFromString(input.trim(), defaultCountry);
  return p && p.isValid() ? p.number : null;
}

/** Formats a phone number for clean and uniform UI display (e.g. "050-123-4567" for Israeli numbers). */
export function formatPhone(input: string | null | undefined, defaultCountry: "IL" = "IL"): string {
  if (!input) return "";
  const trimmed = input.trim();
  const p = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!p || !p.isValid()) return trimmed;
  if (p.country === "IL") {
    return p.formatNational();
  }
  return p.formatInternational();
}
