// A single-appointment iCalendar file (RFC 5545) for the customer's "add to calendar" (CAL-05, BKG-16). Pure: same input, same bytes.
// No external-calendar sync exists (decision D23); this is a one-time download.
export interface IcsEvent {
  /** Stable for the life of the appointment: importing the file twice updates the same event instead of duplicating it. */
  uid: string;
  /** Grows whenever the appointment changes, so calendar apps accept the newer copy. */
  sequence: number;
  /** When the appointment last changed (not "now"), which keeps the output deterministic. */
  stamp: Date;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  status: "TENTATIVE" | "CONFIRMED";
  /** Reminder before the start, in minutes (0 = none). */
  alarmMinutes?: number;
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** TEXT values: backslash, semicolon, comma and newlines are escaped; other control characters are dropped, so user-supplied text can never start a new line or property (SEC-08). */
export const icsText = (s: string) => s.replace(CONTROL, "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** Lines are limited to 75 octets; a longer one continues on the next line after a single space. Never splits a UTF-8 character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // the leading space of a continuation line counts
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function buildIcs(e: IcsEvent): string {
  if (!(e.end > e.start)) throw new Error("an event must end after it starts");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tori//Appointments//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${icsText(e.uid)}`,
    `DTSTAMP:${utc(e.stamp)}`,
    `SEQUENCE:${Math.max(0, Math.floor(e.sequence))}`,
    `DTSTART:${utc(e.start)}`, // UTC instants: correct in every calendar app without shipping a VTIMEZONE
    `DTEND:${utc(e.end)}`,
    `SUMMARY:${icsText(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url.replace(CONTROL, "").replace(/[\r\n]/g, "")}`] : []),
    `STATUS:${e.status}`,
    "TRANSP:OPAQUE",
    ...(e.alarmMinutes ? ["BEGIN:VALARM", `TRIGGER:-PT${Math.floor(e.alarmMinutes)}M`, "ACTION:DISPLAY", `DESCRIPTION:${icsText(e.summary)}`, "END:VALARM"] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
