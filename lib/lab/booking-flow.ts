import { normalizePhone } from "@/lib/phone";

export type BookingStep = "service" | "day" | "time" | "details" | "done";
export const STEP_ORDER: BookingStep[] = ["service", "day", "time", "details", "done"];

export interface BookingDetails {
  fullName: string;
  phone: string;
  email: string;
}

export interface BookingState {
  step: BookingStep;
  serviceId: string | null;
  day: string | null;
  time: string | null;
  details: BookingDetails;
}

export const initialBookingState: BookingState = {
  step: "service",
  serviceId: null,
  day: null,
  time: null,
  details: { fullName: "", phone: "", email: "" },
};

export type BookingAction =
  | { type: "selectService"; serviceId: string }
  | { type: "selectDay"; iso: string }
  | { type: "selectTime"; time: string }
  | { type: "setDetails"; details: BookingDetails }
  | { type: "next" }
  | { type: "back" }
  | { type: "reset" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function detailsValid(d: BookingDetails): boolean {
  return d.fullName.trim().length >= 2 && normalizePhone(d.phone) !== null && (d.email.trim() === "" || EMAIL.test(d.email.trim()));
}

export function canContinue(s: BookingState): boolean {
  switch (s.step) {
    case "service":
      return s.serviceId !== null;
    case "day":
      return s.day !== null;
    case "time":
      return s.time !== null;
    case "details":
      return detailsValid(s.details);
    default:
      return false;
  }
}

export function bookingReducer(s: BookingState, a: BookingAction): BookingState {
  switch (a.type) {
    // Changing an upstream choice invalidates everything downstream (the slot may no longer exist).
    case "selectService":
      return { ...s, serviceId: a.serviceId, day: null, time: null };
    case "selectDay":
      return { ...s, day: a.iso, time: null };
    case "selectTime":
      return { ...s, time: a.time };
    case "setDetails":
      return { ...s, details: a.details };
    case "next": {
      if (!canContinue(s)) return s;
      return { ...s, step: STEP_ORDER[Math.min(STEP_ORDER.indexOf(s.step) + 1, STEP_ORDER.length - 1)] };
    }
    case "back": {
      if (s.step === "done") return s;
      return { ...s, step: STEP_ORDER[Math.max(STEP_ORDER.indexOf(s.step) - 1, 0)] };
    }
    case "reset":
      return initialBookingState;
  }
}
