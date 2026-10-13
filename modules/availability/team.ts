// Several people, one booking page (stage 16, docs/plans/stage-16-team.md). Pure: the single-calendar engine in slots.ts runs once per person and the results are joined.
// A time is offered when at least one eligible person is open (own hours + business-wide closures + own exceptions) and free (own appointments only).
import { addDaysIso, slotsForDay, windowsForDate, type BusyInterval, type DayException, type Slot, type WeeklyRule, type Window } from "@/modules/availability/slots";

export interface TeamPerson {
  id: string;
  name: string;
}
export interface TeamRule extends WeeklyRule {
  resourceId: string;
}
/** resourceId null = a closure/opening of the whole business (T9). */
export interface TeamException extends DayException {
  resourceId: string | null;
}
export interface TeamBusy extends BusyInterval {
  resourceId: string;
}
export interface TeamSlot extends Slot {
  /** Everyone who is open and free at this start, in team order. */
  freeIds: string[];
}

type Common = { timeZone: string; durationMinutes: number; bufferMinutes?: number; stepMinutes?: number; now: Date; minNoticeMinutes?: number };

/** T2: no restriction (null or empty) = everybody. A chosen person must be among the allowed ones, otherwise nobody (never silently someone else). People keep their team order. */
export function eligiblePeople(team: TeamPerson[], staffIds: string[] | null | undefined, personId?: string | null): TeamPerson[] {
  const allowed = staffIds && staffIds.length > 0 ? team.filter((p) => staffIds.includes(p.id)) : team;
  return personId ? allowed.filter((p) => p.id === personId) : allowed;
}

const rulesOf = (rules: TeamRule[], id: string): WeeklyRule[] => rules.filter((r) => r.resourceId === id);
const exceptionsOf = (ex: TeamException[], id: string): DayException[] => ex.filter((e) => e.resourceId === null || e.resourceId === id);

function mergeWindows(ws: Window[]): Window[] {
  const sorted = ws.filter((w) => w.to > w.from).sort((a, b) => a.from - b.from);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out.at(-1);
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else out.push({ ...w });
  }
  return out;
}

/** The hours at which anybody of the team is open on a date (merged). */
export function teamWindowsForDate(date: string, people: TeamPerson[], rules: TeamRule[], exceptions: TeamException[]): Window[] {
  return mergeWindows(people.flatMap((p) => windowsForDate(date, rulesOf(rules, p.id), exceptionsOf(exceptions, p.id))));
}

export function teamSlotsForDay(input: Common & { date: string; people: TeamPerson[]; rules: TeamRule[]; exceptions: TeamException[]; busy: TeamBusy[] }): TeamSlot[] {
  const byStart = new Map<string, TeamSlot>();
  for (const p of input.people) {
    const slots = slotsForDay({ ...input, rules: rulesOf(input.rules, p.id), exceptions: exceptionsOf(input.exceptions, p.id), busy: input.busy.filter((b) => b.resourceId === p.id) });
    for (const s of slots) {
      const have = byStart.get(s.startUtc);
      if (have) have.freeIds.push(p.id);
      else byStart.set(s.startUtc, { ...s, freeIds: [p.id] });
    }
  }
  return [...byStart.values()].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

/** Per-day free-slot counts over a range (the day picker). A day is closed only when nobody works. */
export function teamAvailabilityForRange(input: Common & { people: TeamPerson[]; rules: TeamRule[]; exceptions: TeamException[]; busy: TeamBusy[]; from: string; days: number }) {
  return Array.from({ length: input.days }, (_, i) => {
    const date = addDaysIso(input.from, i);
    return { date, closed: teamWindowsForDate(date, input.people, input.rules, input.exceptions).length === 0, freeSlots: teamSlotsForDay({ ...input, date }).length };
  });
}

/** T5: of the given people, fewest appointments that day first, then team position. Deterministic; returns only the people given. */
export function orderCandidates(team: TeamPerson[], ids: string[], appointmentsThatDay: (id: string) => number): string[] {
  const position = new Map(team.map((p, i) => [p.id, i]));
  return [...new Set(ids)].sort((x, y) => appointmentsThatDay(x) - appointmentsThatDay(y) || (position.get(x) ?? 1e9) - (position.get(y) ?? 1e9));
}

/** Who could start a visit at `time` on `date` by hours alone (ignoring who is busy: the database arbitrates that). */
export function peopleOpenAt(input: Omit<Common, "now"> & { date: string; time: string; people: TeamPerson[]; rules: TeamRule[]; exceptions: TeamException[]; now?: Date }): TeamPerson[] {
  return input.people.filter((p) =>
    slotsForDay({ ...input, rules: rulesOf(input.rules, p.id), exceptions: exceptionsOf(input.exceptions, p.id), now: new Date(0), minNoticeMinutes: 0 }).some((s) => s.local === input.time),
  );
}


/** Is the whole visit inside somebody's opening hours that day? (owner bookings: a flag only, the owner may book anywhere; with a named person only that person counts.) */
export function insideHours(input: { date: string; startMinute: number; durationMinutes: number; people: TeamPerson[]; rules: TeamRule[]; exceptions: TeamException[] }): boolean {
  return teamWindowsForDate(input.date, input.people, input.rules, input.exceptions).some((w) => input.startMinute >= w.from && input.startMinute + input.durationMinutes <= w.to);
}
