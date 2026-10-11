// Prototype data for the design lab (stage 1). Pure and deterministic so the UI and tests agree.
// The real implementation (stage 3/4) replaces this with the availability engine + DB.

export const LAB_TODAY = "2026-10-14"; // a Wednesday
export const LAB_TIMEZONE = "Asia/Jerusalem";

export interface LabService {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceNis: number;
}

export const LAB_SERVICES: LabService[] = [
  { id: "haircut", name: "תספורת גברים", description: "תספורת מדויקת כולל שטיפה ועיצוב", durationMinutes: 30, priceNis: 80 },
  { id: "color", name: "צבע שיער", description: "צביעה מלאה עם טיפול הזנה", durationMinutes: 90, priceNis: 280 },
  { id: "beard", name: "עיצוב זקן", description: "עיצוב וגילוח במספרה", durationMinutes: 20, priceNis: 40 },
  { id: "facial", name: "טיפול פנים", description: "ניקוי עמוק, פילינג ומסכה", durationMinutes: 60, priceNis: 220 },
];

export interface LabDay {
  iso: string; // YYYY-MM-DD
  weekday: number; // 0 = Sunday … 6 = Saturday
  closed: boolean;
}

export interface LabSlot {
  time: string; // HH:mm
  taken: boolean;
}

const STEP_MINUTES = 30;
const OPEN = 9 * 60;
const CLOSE_WEEKDAY = 18 * 60;
const CLOSE_FRIDAY = 13 * 60;

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function addDays(iso: string, n: number): string {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(iso: string): number {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function generateDays(fromIso: string, count: number): LabDay[] {
  return Array.from({ length: count }, (_, i) => {
    const iso = addDays(fromIso, i);
    const weekday = weekdayOf(iso);
    return { iso, weekday, closed: weekday === 6 };
  });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100;
}

const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function generateSlots(
  iso: string,
  service: LabService,
  opts: { includeTaken?: boolean; nowMinutes?: number } = {},
): LabSlot[] {
  const weekday = weekdayOf(iso);
  if (weekday === 6) return [];
  const close = weekday === 5 ? CLOSE_FRIDAY : CLOSE_WEEKDAY;
  const slots: LabSlot[] = [];
  for (let start = OPEN; start + service.durationMinutes <= close; start += STEP_MINUTES) {
    if (opts.nowMinutes !== undefined && start <= opts.nowMinutes) continue;
    const time = toTime(start);
    const taken = hash(`${iso}T${time}`) < 30;
    if (taken && !opts.includeTaken) continue;
    slots.push({ time, taken });
  }
  return slots;
}

export function formatDayLabel(iso: string, style: "long" | "short" = "long"): string {
  const { y, m, d } = parseIso(iso);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long", timeZone: LAB_TIMEZONE }
      : { weekday: "short", day: "numeric", timeZone: LAB_TIMEZONE };
  return new Intl.DateTimeFormat("he-IL", opts).format(date);
}

export function formatTime(time: string): string {
  return time;
}

export function formatPrice(nis: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(nis);
}

export function dayPart(time: string): "morning" | "afternoon" | "evening" {
  const h = Number(time.slice(0, 2));
  return h < 12 ? "morning" : h < 16 ? "afternoon" : "evening";
}

import type { RibbonSegment } from "@/lib/ribbon";

export function dayBounds(iso: string): { from: number; to: number } | null {
  const wd = weekdayOf(iso);
  if (wd === 6) return null;
  return { from: OPEN, to: wd === 5 ? CLOSE_FRIDAY : CLOSE_WEEKDAY };
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** The day as ribbon segments: free windows for this service, booked blocks, and the chosen slot. */
export function slotSegments(iso: string, service: LabService, selectedTime: string | null): RibbonSegment[] {
  const bounds = dayBounds(iso);
  if (!bounds) return [];
  const free = new Set(generateSlots(iso, service).map((x) => toMinutes(x.time)));
  const raw: RibbonSegment[] = [];
  for (let start = bounds.from; start < bounds.to; start += STEP_MINUTES) {
    raw.push({ start, end: start + STEP_MINUTES, state: free.has(start) ? "free" : "booked" });
  }
  if (selectedTime) {
    const a = toMinutes(selectedTime);
    const b = a + service.durationMinutes;
    for (const seg of raw) if (seg.start >= a && seg.start < b) seg.state = "selected";
  }
  const merged: RibbonSegment[] = [];
  for (const seg of raw) {
    const last = merged.at(-1);
    if (last && last.state === seg.state && last.end === seg.start) last.end = seg.end;
    else merged.push({ ...seg });
  }
  return merged;
}
