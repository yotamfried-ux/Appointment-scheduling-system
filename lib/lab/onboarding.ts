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
  business: { name: string; type: string; phone: string };
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
  business: { name: "", type: "barber", phone: "" },
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

/** A window is valid when it ends after it starts; windows of one day must not overlap (touching is fine). */
export function windowsValid(windows: HoursWindow[]): boolean {
  if (windows.length === 0 || windows.some((w) => !(w.from < w.to))) return false;
  const sorted = [...windows].sort((a, b) => a.from.localeCompare(b.from));
  return sorted.every((w, i) => i === 0 || sorted[i - 1].to <= w.from);
}

export function hoursValid(hours: DayHours[]): boolean {
  const open = hours.filter((h) => h.open);
  return open.length > 0 && open.every((h) => windowsValid(h.windows));
}

/** Per-day problem for inline messages. */
export function windowProblem(windows: HoursWindow[], index: number): "order" | "overlap" | null {
  const w = windows[index];
  if (!(w.from < w.to)) return "order";
  return windows.some((o, i) => i !== index && o.from < w.to && w.from < o.to) ? "overlap" : null;
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
      return { ...s, hours: s.hours.map((h) => (h.weekday === a.weekday ? { ...h, open: !h.open } : h)) };
    case "setHours":
      return { ...s, hours: s.hours.map((h) => (h.weekday === a.weekday ? { ...h, windows: h.windows.map((w, i) => (i === a.index ? { from: a.from, to: a.to } : w)) } : h)) };
    case "addWindow":
      return {
        ...s,
        hours: s.hours.map((h) => {
          if (h.weekday !== a.weekday || h.windows.length >= 3) return h;
          const last = h.windows.at(-1)!;
          const from = hhmm(Math.min(toMin(last.to) + 60, 22 * 60));
          return { ...h, windows: [...h.windows, { from, to: hhmm(Math.min(toMin(from) + 120, 24 * 60 - 1)) }] };
        }),
      };
    case "removeWindow":
      return { ...s, hours: s.hours.map((h) => (h.weekday === a.weekday && h.windows.length > 1 ? { ...h, windows: h.windows.filter((_, i) => i !== a.index) } : h)) };
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
