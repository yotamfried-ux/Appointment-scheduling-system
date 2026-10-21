import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** Normalises an Israeli (or international) phone to E.164, or null if invalid (ACC-03). */
export function normalizePhone(input: string, defaultCountry: "IL" = "IL"): string | null {
  const p = parsePhoneNumberFromString(input.trim(), defaultCountry);
  return p && p.isValid() ? p.number : null;
}
