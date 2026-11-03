import { normalizePhone } from "@/lib/phone";
import { BUSINESS_KINDS, KIND_IDS, type BusinessKindId } from "@/modules/tenancy/business-kind";

// Prototype logic for the onboarding wizard (stage 1). Pure, unit-tested; reused when the real
// onboarding is wired to the database in stage 2.

export type OnboardingStep = "business" | "services" | "hours" | "done";
export const ONBOARDING_STEPS: OnboardingStep[] = ["business", "services", "hours", "done"];

export const BUSINESS_TYPES = KIND_IDS.map((id) => ({ id, label: BUSINESS_KINDS[id].label }));

export interface OnboardingService {
  id: string;
  name: string;
  durationMinutes: number;
  priceNis: number;
}
export interface HoursWindow {
  from: string; // HH:mm
  to: string;
}
export interface DayHours {
  weekday: number; // 0 = Sunday
  open: boolean;
  /** Several windows = a split day (e.g. a trainer: early morning + evening). Kept even while the day is closed. */
  windows: HoursWindow[];
}

export interface OnboardingState {
  step: OnboardingStep;
  business: { name: string; ownerName?: string; type: string; phone: string };
  services: OnboardingService[];
  hours: DayHours[];
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Working hours and starter services for a business kind (docs/03 §5: kinds are data, not forks). */
export function kindHours(kind: BusinessKindId): DayHours[] {
  const k = BUSINESS_KINDS[kind];
  return k.hours.map((w, weekday) => ({
    weekday,
    open: w.length > 0,
    windows: (w.length ? w : [{ from: 9 * 60, to: 17 * 60 }]).map((x) => ({ from: hhmm(x.from), to: hhmm(x.to) })),
  }));
}
export const kindServices = (kind: BusinessKindId): Omit<OnboardingService, "id">[] =>
  BUSINESS_KINDS[kind].presets.map((p) => ({ name: p.name, durationMinutes: p.durationMinutes, priceNis: p.priceNis }));

export const DEFAULT_HOURS: DayHours[] = kindHours("barber");

export const initialOnboarding: OnboardingState = {
  step: "business",
  business: { name: "", ownerName: "", type: "barber", phone: "" },
  services: kindServices("barber").map((x, i) => ({ id: `k${i + 1}`, ...x })),
  hours: DEFAULT_HOURS,
};

const RESERVED = new Set(["admin", "api", "login", "auth", "book", "app", "www", "dashboard", "settings", "design", "static"]);

const HE: Record<string, string> = {
  א: "a", ב: "b", ג: "g", ד: "d", ה: "h", ו: "v", ז: "z", ח: "ch", ט: "t", י: "y", כ: "k", ך: "k", ל: "l", מ: "m", ם: "m",
  נ: "n", ן: "n", ס: "s", ע: "a", פ: "p", ף: "f", צ: "tz", ץ: "tz", ק: "k", ר: "r", ש: "sh", ת: "t",
};

/** Cuts to `max` chars at the last hyphen (never mid-word) unless that would leave fewer than 3 characters. */
function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const i = head.lastIndexOf("-");
  return (i >= 3 ? head.slice(0, i) : head).replace(/-+$/g, "");
}

/** ASCII, URL-safe, ≤40 chars, never a reserved route (ACC-06). Final uniqueness is enforced by the DB. */
export function suggestSlug(name: string): string {
  const latin = Array.from(name.trim().toLowerCase())
    .map((c) => HE[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const slug0 = cutAtWord(latin, 40);
  const slug = slug0 || "business";
  return RESERVED.has(slug) ? `${slug}-1` : slug;
}

export function serviceValid(s: OnboardingService): boolean {
  return s.name.trim().length >= 2 && s.durationMinutes > 0 && s.priceNis > 0;
}

export const isValidHHmm = (t: string, allow24End = false): boolean =>
  (allow24End ? /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/ : /^([01]\d|2[0-3]):[0-5]\d$/).test(t);

/** A window is valid when it has valid HH:MM format, ends after it starts, and windows of one day do not overlap (touching is fine). */
export function windowsValid(windows: HoursWindow[]): boolean {
  if (windows.length === 0 || windows.some((w) => !isValidHHmm(w.from, false) || !isValidHHmm(w.to, true) || !(toMin(w.from) < toMin(w.to)))) return false;
  const sorted = [...windows].sort((a, b) => toMin(a.from) - toMin(b.from));
  return sorted.every((w, i) => i === 0 || toMin(sorted[i - 1].to) <= toMin(w.from));
}

export function hoursValid(hours: DayHours[]): boolean {
  const open = hours.filter((h) => h.open);
  return open.length > 0 && open.every((h) => windowsValid(h.windows));
}

/** Per-day problem for inline messages. */
export function windowProblem(windows: HoursWindow[], index: number): "order" | "overlap" | "format" | null {
  const w = windows[index];
  if (!isValidHHmm(w.from, false) || !isValidHHmm(w.to, true)) return "format";
  if (!(toMin(w.from) < toMin(w.to))) return "order";
  return windows.some((o, i) => i !== index && isValidHHmm(o.from, false) && isValidHHmm(o.to, true) && toMin(o.from) < toMin(w.to) && toMin(w.from) < toMin(o.to))
    ? "overlap"
    : null;
}

export function windowDurationMinutes(w: HoursWindow): number {
  if (!isValidHHmm(w.from, false) || !isValidHHmm(w.to, true)) return 0;
  return toMin(w.to) - toMin(w.from);
}

export function windowShorterThanService(w: HoursWindow, minServiceDuration?: number): boolean {
  if (!minServiceDuration || minServiceDuration <= 0) return false;
  const d = windowDurationMinutes(w);
  return d > 0 && d < minServiceDuration;
}

export { toMin as onboardingToMinutes };

export function canContinueOnboarding(s: OnboardingState): boolean {
  switch (s.step) {
    case "business":
      return s.business.name.trim().length >= 2 && normalizePhone(s.business.phone) !== null;
    case "services":
      return s.services.length > 0 && s.services.every(serviceValid);
    case "hours":
      return hoursValid(s.hours);
    default:
      return false;
  }
}

export function pickNextNonOverlappingWindow(windows: HoursWindow[]): HoursWindow | null {
  const valid = windows
    .filter((w) => isValidHHmm(w.from, false) && isValidHHmm(w.to, true) && toMin(w.from) < toMin(w.to))
    .map((w) => ({ from: toMin(w.from), to: toMin(w.to) }));

  if (valid.length === 0) return { from: "09:00", to: "17:00" };

  // Calculate disjoint free gaps across [0, 24*60]
  const sorted = [...valid].sort((a, b) => a.from - b.from);
  const gaps: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const w of sorted) {
    if (w.from > cursor) gaps.push({ from: cursor, to: w.from });
    cursor = Math.max(cursor, w.to);
  }
  if (cursor < 24 * 60) gaps.push({ from: cursor, to: 24 * 60 });

  const positiveGaps = gaps.filter((g) => g.to - g.from >= 1);
  if (positiveGaps.length === 0) {
    return null;
  }

  const last = valid.at(-1)!;
  const maxEnd = Math.max(...valid.map((w) => w.to));

  // If the last window is the latest one on the day and there is room after it:
  if (last.to === maxEnd && maxEnd < 24 * 60) {
    if (maxEnd + 180 <= 24 * 60) {
      const from = maxEnd + 60;
      return { from: hhmm(from), to: hhmm(Math.min(from + 120, 24 * 60)) };
    }
    if (maxEnd + 60 <= 24 * 60) {
      return { from: hhmm(maxEnd), to: hhmm(Math.min(maxEnd + 60, 24 * 60)) };
    }
    const step = Math.max(1, Math.min(15, 24 * 60 - maxEnd));
    return { from: hhmm(maxEnd), to: hhmm(maxEnd + step) };
  }

  // Otherwise pick the best available gap:
  // 1. Gap after the last window
  // 2. Daytime gap (>=08:00) with >=15m
  // 3. Any gap >=15m
  // 4. Any remaining positive gap
  const afterLast = positiveGaps.find((g) => g.from >= last.to);
  const daytimeGap = positiveGaps.find((g) => g.from >= 8 * 60 && g.to - g.from >= 15);
  const largeGap = positiveGaps.find((g) => g.to - g.from >= 15);
  const chosen = afterLast ?? daytimeGap ?? largeGap ?? positiveGaps[0];

  if (chosen) {
    let start = chosen.from;
    if (chosen.from === 0 && chosen.to >= 7 * 60) {
      start = 6 * 60;
    }
    const available = chosen.to - start;
    const len = available >= 60 ? 60 : available >= 15 ? 15 : Math.max(1, available);
    return { from: hhmm(start), to: hhmm(start + len) };
  }

  return null;
}

// Pure hours edits, shared by the onboarding reducer and the settings page.
export const toggleDay = (hours: DayHours[], weekday: number): DayHours[] => hours.map((h) => (h.weekday === weekday ? { ...h, open: !h.open } : h));
export const setWindow = (hours: DayHours[], weekday: number, index: number, from: string, to: string): DayHours[] =>
  hours.map((h) => (h.weekday === weekday ? { ...h, windows: h.windows.map((w, i) => (i === index ? { from, to } : w)) } : h));
export const addWindow = (hours: DayHours[], weekday: number): DayHours[] =>
  hours.map((h) => {
    if (h.weekday !== weekday) return h;
    const next = pickNextNonOverlappingWindow(h.windows);
    if (!next) return h;
    return { ...h, windows: [...h.windows, next] };
  });
export const removeWindow = (hours: DayHours[], weekday: number, index: number): DayHours[] =>
  hours.map((h) => (h.weekday === weekday && h.windows.length > 1 ? { ...h, windows: h.windows.filter((_, i) => i !== index) } : h));

export type OnboardingAction =
  | { type: "setBusiness"; business: OnboardingState["business"] }
  | { type: "setType"; kind: BusinessKindId }
  | { type: "addService"; service?: Omit<OnboardingService, "id"> }
  | { type: "removeService"; id: string }
  | { type: "updateService"; id: string; patch: Partial<Omit<OnboardingService, "id">> }
  | { type: "toggleDay"; weekday: number }
  | { type: "setHours"; weekday: number; index: number; from: string; to: string }
  | { type: "addWindow"; weekday: number }
  | { type: "removeWindow"; weekday: number; index: number }
  | { type: "next" }
  | { type: "back" };

let seq = 1;
const newId = () => `s${++seq}-${seq}`;

export function onboardingReducer(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case "setBusiness":
      return { ...s, business: a.business };
    case "setType": {
      if (s.business.type === a.kind) return s;
      // Switching kind re-seeds services and hours with that kind's defaults (nothing else has been entered after step 1).
      return { ...s, business: { ...s.business, type: a.kind }, services: kindServices(a.kind).map((x, i) => ({ id: `k${i + 1}`, ...x })), hours: kindHours(a.kind) };
    }
    case "addService":
      return { ...s, services: [...s.services, { id: newId(), ...(a.service ?? { name: "", durationMinutes: 30, priceNis: 0 }) }] };
    case "removeService":
      return s.services.length <= 1 ? s : { ...s, services: s.services.filter((x) => x.id !== a.id) };
    case "updateService":
      return { ...s, services: s.services.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case "toggleDay":
      return { ...s, hours: toggleDay(s.hours, a.weekday) };
    case "setHours":
      return { ...s, hours: setWindow(s.hours, a.weekday, a.index, a.from, a.to) };
    case "addWindow":
      return { ...s, hours: addWindow(s.hours, a.weekday) };
    case "removeWindow":
      return { ...s, hours: removeWindow(s.hours, a.weekday, a.index) };
    case "next": {
      if (!canContinueOnboarding(s)) return s;
      return { ...s, step: ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(s.step) + 1] };
    }
    case "back": {
      if (s.step === "done") return s;
      return { ...s, step: ONBOARDING_STEPS[Math.max(0, ONBOARDING_STEPS.indexOf(s.step) - 1)] };
    }
  }
}
