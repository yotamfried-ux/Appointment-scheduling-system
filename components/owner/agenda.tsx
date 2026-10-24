"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { z } from "zod";
import { ApprovalsPanel, type ApprovalAction } from "@/components/lab/dashboard/approvals-panel";
import { DaySchedule } from "@/components/lab/dashboard/day-schedule";
import { StatStrip } from "@/components/lab/dashboard/stat-strip";
import { ManualDialog } from "@/components/owner/manual-dialog";
import { MoveDialog } from "@/components/owner/move-dialog";
import { OfferDialog } from "@/components/owner/offer-dialog";
import { UndeliveredBanner } from "@/components/owner/undelivered-banner";
import { WaitlistPanel, type WaitlistEntry } from "@/components/owner/waitlist-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dismissAllToasts, toast } from "@/components/ui/toast";
import { ApiClientError, ownerApi } from "@/lib/api/client";
import type * as C from "@/lib/api/contracts";
import { formatDayLabel, LAB_TIMEZONE } from "@/lib/lab/booking-data";
import { dashboardReducer, fmt, freeLabel, gapsIn, statsIn, teamOccupancyPct, type LabAppointment } from "@/lib/lab/dashboard-data";
import { cn } from "@/lib/utils";
import { addDaysIso } from "@/modules/availability/slots";

type Agenda = z.infer<typeof C.OwnerAgendaResponse>;
type Action = z.infer<typeof C.OwnerAction>;
type CalendarView = "day" | "week" | "month";
const toLab = (a: Agenda["appointments"][number]): LabAppointment => a;

const WEEKDAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const shortDateLabel = (iso: string) =>
  new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: LAB_TIMEZONE }).format(new Date(`${iso}T12:00:00Z`));
const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: LAB_TIMEZONE }).format(new Date(`${iso}T12:00:00Z`));

function computeRangeForView(anchor: string | undefined, view: CalendarView): { from: string; to: string } | undefined {
  if (!anchor || view === "day") return undefined;
  if (view === "week") {
    const wd = weekdayOf(anchor);
    const from = addDaysIso(anchor, -wd);
    const to = addDaysIso(from, 6);
    return { from, to };
  }
  // month view: from the Sunday of the first week of the month to the Saturday of the last week
  const [y, m] = anchor.split("-").map(Number);
  const firstOfMonth = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastOfMonth = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const from = addDaysIso(firstOfMonth, -weekdayOf(firstOfMonth));
  const to = addDaysIso(lastOfMonth, 6 - weekdayOf(lastOfMonth));
  return { from, to };
}

function shiftMonthIso(iso: string, deltaMonths: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + deltaMonths, 1, 12, 0, 0));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  const maxDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(d, maxDay);
  return `${String(ty).padStart(4, "0")}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

/** The owner's working day, week, or month: who is coming, what needs a decision, what is free. */
export function OwnerAgenda() {
  const t = useTranslations("owner");
  const router = useRouter();
  const [view, setView] = useState<CalendarView>("day");
  const [date, setDate] = useState<string | undefined>(undefined);
  const [load, setLoad] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; agenda: Agenda }>({ status: "loading" });
  const [state, dispatch] = useReducer(dashboardReducer, { appointments: [] as LabAppointment[] });
  const [inbox, setInbox] = useState<LabAppointment[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; time: string; date?: string }>({ open: false, time: "" });
  const [offering, setOffering] = useState<WaitlistEntry | null>(null);
  const [moving, setMoving] = useState<LabAppointment | null>(null);
  const [person, setPerson] = useState<string | undefined>(undefined);
  const [pollMs, setPollMs] = useState(10_000);
  const inFlight = useRef(false);

  const viewedDate = date ?? (load.status === "ready" ? load.agenda.date : undefined);
  const activeRange = useMemo(() => computeRangeForView(viewedDate, view), [viewedDate, view]);

  const refresh = useCallback(
    async (d: string | undefined, signal?: AbortSignal, rng?: { from: string; to: string }) => {
      try {
        const agenda = await ownerApi.agenda(d, signal, person, rng);
        dispatch({ type: "replace", appointments: agenda.appointments.map(toLab) });
        setInbox(agenda.inbox.map(toLab));
        setLoad({ status: "ready", agenda });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ApiClientError && e.code === "UNAUTHENTICATED") return router.replace("/auth/login");
        setLoad((prev) => (prev.status === "ready" ? prev : { status: "error" }));
      }
    },
    [router, person],
  );
  useEffect(() => {
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the viewed day/range from the API
    void refresh(date, ctl.signal, activeRange);
    return () => ctl.abort();
  }, [date, activeRange, refresh]);

  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("poll"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the optional ?poll= once on the client
    if (Number.isInteger(n) && n >= 500 && n <= 60_000) setPollMs(n);
  }, []);
  const version = load.status === "ready" ? load.agenda.version : null;
  useEffect(() => {
    if (version === null) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || inFlight.current) return;
      try {
        const v = await ownerApi.version();
        if (!stopped && v !== version && !inFlight.current) void refresh(viewedDate, undefined, activeRange);
      } catch {
        /* offline or expired session: the next tick or the next action reports it */
      }
    };
    const id = setInterval(check, pollMs);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [version, viewedDate, activeRange, pollMs, refresh]);

  const current = load.status === "ready" ? load.agenda.date : date;
  const reload = () => refresh(current, undefined, activeRange);

  async function act(action: Action, a: LabAppointment, success: [string, "success" | "info" | "warning"]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy((b) => new Set(b).add(a.id));
    setConfirming(null);
    dispatch({ type: action, id: a.id });
    if (action === "approve" || action === "reject" || action === "approveCancellation" || action === "declineCancellation" || action === "cancel") setInbox((l) => l.filter((x) => x.id !== a.id));
    try {
      await ownerApi.transition(a.id, action);
      toast(success[0], { variant: success[1] });
      if (view !== "day") await reload();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "UNAUTHENTICATED") router.replace("/auth/login");
      else toast(e instanceof ApiClientError && e.code === "INVALID_TRANSITION" ? t("agenda.errStale") : e instanceof ApiClientError && e.code === "TOO_EARLY" ? t("agenda.errTooEarly") : t("agenda.errAction"), { variant: "warning" });
      await reload();
    } finally {
      inFlight.current = false;
      setBusy(new Set());
    }
  }

  const onApproval = (action: ApprovalAction, a: LabAppointment) => {
    const copy: Record<ApprovalAction, [string, "success" | "info" | "warning"]> = {
      approve: [t("agenda.toastApproved"), "success"],
      reject: [t("agenda.toastRejected"), "info"],
      approveCancellation: [t("agenda.toastCancellationApproved"), "warning"],
      declineCancellation: [t("agenda.toastKept"), "info"],
    };
    return act(action, a, copy[action]);
  };

  async function waitlistRun(fn: () => Promise<unknown>, okMessage: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(new Set(["waitlist"]));
    try {
      await fn();
      toast(okMessage, { variant: "success" });
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "UNAUTHENTICATED") router.replace("/auth/login");
      else toast(e instanceof ApiClientError && e.code === "INVALID_TRANSITION" ? t("agenda.errStale") : t("waitlist.errAction"), { variant: "warning" });
    } finally {
      inFlight.current = false;
      setBusy(new Set());
      await reload();
    }
  }

  if (load.status === "error") {
    return (
      <div className="grid justify-items-center gap-3 rounded-lg border bg-card p-8 text-center" data-testid="agenda-load-error">
        <p className="font-semibold">{t("agenda.errLoad")}</p>
        <Button onClick={() => { setLoad({ status: "loading" }); void reload(); }}>{t("errors.retry")}</Button>
      </div>
    );
  }
  if (load.status === "loading") return <p role="status" aria-busy="true" className="py-10 text-center text-muted-foreground">{t("loading")}</p>;

  const { agenda } = load;
  const team = agenda.people.length > 1;
  const filtering = team && agenda.person !== null;
  const windows = agenda.windows;
  const appts = state.appointments;
  const stats = statsIn(appts, windows);
  const shownPeople = agenda.people.filter((p) => !filtering || p.id === agenda.person);
  const freeMinutes = team
    ? shownPeople.reduce((sum, p) => sum + gapsIn(appts.filter((a) => a.personId === p.id), p.windows, 30).reduce((s, g) => s + (g.end - g.start), 0), 0)
    : gapsIn(appts, windows, 30).reduce((s, g) => s + (g.end - g.start), 0);
  const isPast = agenda.date < agenda.today;
  const started = (a: LabAppointment) => isPast || (agenda.now !== null && a.start <= agenda.now);
  const go = (d: string) => setDate(d);

  const rowActions = (a: LabAppointment) => {
    const off = busy.size > 0;
    if (a.status === "completed")
      return <Button size="sm" variant="ghost" disabled={off} onClick={() => act("noShow", a, [t("agenda.toastNoShow"), "info"])} data-testid={`fix-noshow-${a.id}`}>{t("agenda.fixNoShow")}</Button>;
    if (a.status === "noShow")
      return <Button size="sm" variant="ghost" disabled={off} onClick={() => act("complete", a, [t("agenda.toastCompleted"), "success"])} data-testid={`fix-attended-${a.id}`}>{t("agenda.fixAttended")}</Button>;
    if (a.status !== "confirmed") return null;
    if (started(a))
      return (
        <>
          <Button size="sm" variant="ghost" disabled={off} onClick={() => act("complete", a, [t("agenda.toastCompleted"), "success"])} data-testid={`complete-${a.id}`}>{t("agenda.complete")}</Button>
          <Button size="sm" variant="ghost" disabled={off} onClick={() => act("noShow", a, [t("agenda.toastNoShow"), "info"])} data-testid={`noshow-${a.id}`}>{t("agenda.noShow")}</Button>
        </>
      );
    if (confirming === a.id)
      return (
        <div role="group" aria-label={t("agenda.cancelConfirm")} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("agenda.cancelConfirm")}</span>
          <Button size="sm" variant="destructive" disabled={off} onClick={() => act("cancel", a, [t("agenda.toastCancelled"), "warning"])} data-testid={`cancel-yes-${a.id}`}>{t("agenda.cancelYes")}</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>{t("agenda.cancelNo")}</Button>
        </div>
      );
    return (
      <>
        <Button size="sm" variant="ghost" disabled={off} onClick={() => { dismissAllToasts(); setMoving(a); }} data-testid={`move-${a.id}`}>{t("agenda.move")}</Button>
        <Button size="sm" variant="ghost" disabled={off} onClick={() => setConfirming(a.id)} data-testid={`cancel-${a.id}`}>{t("agenda.cancel")}</Button>
      </>
    );
  };

  const navPrev = () => {
    if (view === "week") return go(addDaysIso(agenda.date, -7));
    if (view === "month") return go(shiftMonthIso(agenda.date, -1));
    return go(addDaysIso(agenda.date, -1));
  };
  const navNext = () => {
    if (view === "week") return go(addDaysIso(agenda.date, 7));
    if (view === "month") return go(shiftMonthIso(agenda.date, 1));
    return go(addDaysIso(agenda.date, 1));
  };

  const rangeDays = agenda.rangeDays ?? [];
  const currentMonthPrefix = agenda.date.slice(0, 7);

  return (
    <div className="grid min-w-0 gap-8 [&>*]:min-w-0" data-testid="agenda">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight" data-testid="agenda-title">
            {view === "month"
              ? monthLabel(agenda.date)
              : view === "week" && rangeDays.length > 0
                ? `${shortDateLabel(rangeDays[0].date)} – ${shortDateLabel(rangeDays.at(-1)!.date)}`
                : formatDayLabel(agenda.date)}
          </h2>
          {view === "day" && isPast ? <p className="mt-1 text-sm text-muted-foreground">{t("agenda.pastHint")}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View Switcher: Daily | Weekly | Monthly */}
          <div role="group" aria-label="תצוגת יומן" className="inline-flex rounded-lg border bg-card p-1">
            <button
              type="button"
              onClick={() => setView("day")}
              aria-pressed={view === "day"}
              data-testid="view-day"
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                view === "day" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              יומי
            </button>
            <button
              type="button"
              onClick={() => setView("week")}
              aria-pressed={view === "week"}
              data-testid="view-week"
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                view === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              שבועי
            </button>
            <button
              type="button"
              onClick={() => setView("month")}
              aria-pressed={view === "month"}
              data-testid="view-month"
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                view === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              חודשי
            </button>
          </div>

          <Button variant="outline" size="icon" aria-label={t("agenda.prev")} onClick={navPrev} data-testid="day-prev"><ChevronRight aria-hidden /></Button>
          <Button variant="outline" disabled={agenda.date === agenda.today} onClick={() => go(agenda.today)} data-testid="day-today">{t("agenda.today")}</Button>
          <Button variant="outline" size="icon" aria-label={t("agenda.next")} onClick={navNext} data-testid="day-next"><ChevronLeft aria-hidden /></Button>
          <Input type="date" dir="ltr" className="h-11 w-auto text-start" aria-label={t("agenda.goTo")} value={agenda.date} onChange={(e) => e.target.value && go(e.target.value)} data-testid="day-input" />
          <Button onClick={() => { dismissAllToasts(); setDialog({ open: true, time: "", date: agenda.date }); }} data-testid="new-appointment"><Plus aria-hidden />{t("agenda.newAppointment")}</Button>
        </div>
      </div>

      <UndeliveredBanner items={agenda.undeliveredItems} onOpenDay={(d) => { setPerson(undefined); go(d); }} />

      {agenda.orphans.total > 0 ? (
        <section role="status" className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" data-testid="orphans">
          <p className="font-medium">{t("team.orphans", { count: agenda.orphans.total })}</p>
          <ul className="grid gap-1">
            {agenda.orphans.items.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                <span><bdi>{o.date}</bdi> · <bdi>{fmt(o.start)}</bdi> · {o.customer} · {o.personName}</span>
                <Button size="sm" variant="outline" onClick={() => { setPerson(undefined); go(o.date); }} data-testid={`orphan-open-${o.id}`}>{t("team.openDay")}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {team ? (
        <div role="group" aria-label={t("team.filter")} className="flex flex-wrap gap-2" data-testid="person-filter">
          <Button size="sm" variant={agenda.person === null ? "default" : "outline"} aria-pressed={agenda.person === null} onClick={() => setPerson(undefined)} data-testid="filter-all">{t("team.everyone")}</Button>
          {agenda.people.map((p) => (
            <Button key={p.id} size="sm" variant={agenda.person === p.id ? "default" : "outline"} aria-pressed={agenda.person === p.id} onClick={() => setPerson(p.id)} data-testid={`filter-${p.id}`}>{p.name}</Button>
          ))}
        </div>
      ) : null}

      <StatStrip
        stats={[
          { label: t("stats.appointments"), value: String(stats.total), hint: t("stats.confirmedHint", { count: appts.filter((a) => a.status === "confirmed" || a.status === "completed").length }) },
          { label: t("stats.pending"), value: String(inbox.length), hint: t("stats.pendingHint"), tone: inbox.length > 0 ? "attention" : "default" },
          { label: t("stats.occupancy"), value: `${team ? teamOccupancyPct(shownPeople.map((p) => ({ appts: appts.filter((a) => a.personId === p.id), windows: p.windows }))) : stats.occupancyPct}%`, hint: t("stats.occupancyHint") },
          { label: t("stats.free"), value: freeLabel(freeMinutes, t), hint: t("stats.freeHint") },
        ]}
      />

      {/* VIEW 1: DAILY VIEW */}
      {view === "day" && (
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_26rem] [&>*]:min-w-0">
          <section aria-labelledby="schedule-title" className="grid gap-3">
            <h3 id="schedule-title" className="text-base font-semibold">{t("today.schedule")}</h3>
            {appts.some((a) => a.status !== "cancelled") || windows.length ? (
              <DaySchedule
                appointments={appts}
                windows={windows}
                now={agenda.now}
                renderActions={rowActions}
                showPerson={team}
                showGaps={!team || filtering}
                onAddInGap={(start) => {
                  dismissAllToasts();
                  setDialog({ open: true, time: fmt(start), date: agenda.date });
                }}
              />
            ) : (
              <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="no-appointments">{t("agenda.noAppointments")}</p>
            )}
          </section>
          <div className={cn("grid gap-6", inbox.length > 0 && "order-first xl:order-none")}>
            <section aria-labelledby="overview-title" className="grid gap-3">
              <h3 id="overview-title" className="text-base font-semibold">{t("today.overview")}</h3>
              <div className="rounded-xl border bg-card p-4">
                {windows.length ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">שעות פעילות היום</span>
                    <span className="font-semibold tabular-nums">
                      <bdi>{windows.map((w) => `${fmt(w.from)}–${fmt(w.to)}`).join(" · ")}</bdi>
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="closed-today">{appts.length ? t("agenda.closedWithManual") : t("agenda.closed")}</p>
                )}
              </div>
            </section>
            <ApprovalsPanel appointments={inbox} onAction={onApproval} busyIds={busy} />
            <WaitlistPanel
              entries={agenda.waitlist}
              settings={agenda.settings}
              busy={busy.size > 0}
              allowed={agenda.billing?.features.waitlist ?? true}
              onOffer={(e) => setOffering(e)}
              onRemove={(e) => waitlistRun(() => ownerApi.waitlistRemove(e.id), t("waitlist.toastRemoved"))}
              onSettings={(patch) => waitlistRun(() => ownerApi.waitlistSettings(patch), t("waitlist.toastEnabled"))}
            />
          </div>
        </div>
      )}

      {/* VIEW 2: WEEKLY VIEW (OPTION A — SMART DAY COLUMNS / BOARD) */}
      {view === "week" && (
        <section aria-label="תצוגה שבועית" className="grid gap-4" data-testid="week-board">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
            {rangeDays.map((day) => {
              const wd = weekdayOf(day.date);
              const isToday = day.date === agenda.today;
              const isSelected = day.date === agenda.date;
              const activeAppts = day.appointments.filter((a) => a.status !== "cancelled");
              const gaps = (!team || filtering) ? gapsIn(activeAppts, day.windows, 30) : [];
              type BoardItem =
                | { kind: "appt"; start: number; appt: LabAppointment }
                | { kind: "gap"; start: number; end: number };
              const items: BoardItem[] = [
                ...activeAppts.map((appt) => ({ kind: "appt" as const, start: appt.start, appt })),
                ...gaps.map((g) => ({ kind: "gap" as const, start: g.start, end: g.end })),
              ].sort((a, b) => a.start - b.start);

              return (
                <div
                  key={day.date}
                  data-testid={`week-col-${day.date}`}
                  className={cn(
                    "flex flex-col rounded-xl border bg-card p-3 transition-colors",
                    isSelected && "ring-1 ring-primary",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      go(day.date);
                      setView("day");
                    }}
                    className="flex items-center justify-between gap-2 border-b pb-2.5 text-start hover:opacity-80"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold">{WEEKDAYS_HE[wd]}</span>
                        {isToday ? <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">היום</span> : null}
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums"><bdi>{shortDateLabel(day.date)}</bdi></span>
                    </div>
                    <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-semibold tabular-nums">
                      {activeAppts.length}
                    </span>
                  </button>

                  <div className="mt-3 flex flex-1 flex-col gap-2">
                    {day.closed && activeAppts.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">סגור</p>
                    ) : items.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          dismissAllToasts();
                          setDialog({ open: true, time: day.windows[0] ? fmt(day.windows[0].from) : "09:00", date: day.date });
                        }}
                        className="rounded-lg border border-dashed p-3 text-center text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-foreground"
                      >
                        + הוספת תור
                      </button>
                    ) : (
                      items.map((item, idx) =>
                        item.kind === "appt" ? (
                          <div
                            key={item.appt.id}
                            onClick={() => {
                              go(day.date);
                              setView("day");
                            }}
                            className="cursor-pointer rounded-lg border bg-background p-2.5 text-start transition hover:border-primary/60"
                          >
                            <div className="flex items-center justify-between gap-1 text-xs font-semibold tabular-nums">
                              <bdi>{fmt(item.appt.start)}–{fmt(item.appt.end)}</bdi>
                              {item.appt.status === "pending" ? (
                                <span className="text-[11px] font-medium text-muted-foreground">ממתין</span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-xs font-bold">{item.appt.customer}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {item.appt.service}
                              {team ? ` · ${item.appt.personName}` : ""}
                            </p>
                          </div>
                        ) : (
                          <button
                            key={`gap-${idx}-${item.start}`}
                            type="button"
                            onClick={() => {
                              dismissAllToasts();
                              setDialog({ open: true, time: fmt(item.start), date: day.date });
                            }}
                            className="flex items-center justify-between gap-1 rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
                          >
                            <span className="font-medium">+ פנוי</span>
                            <bdi className="tabular-nums">{fmt(item.start)}–{fmt(item.end)}</bdi>
                          </button>
                        ),
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* VIEW 3: MONTHLY VIEW (OPTION A — SIDE INSPECTOR PANEL) */}
      {view === "month" && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]" data-testid="month-view">
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-xs font-semibold text-muted-foreground">
              {WEEKDAYS_HE.map((w) => (
                <div key={w} className="py-2.5">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 divide-x divide-y rtl:divide-x-reverse">
              {rangeDays.map((day) => {
                const inMonth = day.date.startsWith(currentMonthPrefix);
                const isSelected = day.date === agenda.date;
                const isToday = day.date === agenda.today;
                const activeAppts = day.appointments.filter((a) => a.status !== "cancelled");
                const dayNum = Number(day.date.slice(8, 10));

                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => go(day.date)}
                    data-testid={`month-cell-${day.date}`}
                    className={cn(
                      "flex min-h-24 flex-col items-stretch justify-between p-2 text-start transition hover:bg-muted/40 sm:min-h-28 sm:p-2.5",
                      !inMonth && "opacity-45",
                      isSelected && "bg-primary/10 ring-1 ring-inset ring-primary",
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span
                        className={cn(
                          "inline-flex size-6 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                          isToday && "bg-primary text-primary-foreground",
                        )}
                      >
                        {dayNum}
                      </span>
                      {activeAppts.length > 0 ? (
                        <span className="rounded-full border bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                          {activeAppts.length}
                        </span>
                      ) : day.closed ? (
                        <span className="text-[10px] text-muted-foreground">סגור</span>
                      ) : null}
                    </div>

                    <div className="mt-1.5 grid w-full gap-1">
                      {activeAppts.slice(0, 2).map((a) => (
                        <div key={a.id} className="truncate rounded border bg-background px-1.5 py-0.5 text-[11px] leading-tight">
                          <bdi className="font-semibold tabular-nums">{fmt(a.start)}</bdi> {a.customer}
                        </div>
                      ))}
                      {activeAppts.length > 2 ? (
                        <span className="text-[10px] font-medium text-muted-foreground">+{activeAppts.length - 2} נוספים</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side Inspector Panel */}
          <aside aria-label="פירוט יום נבחר" className="grid gap-4 rounded-xl border bg-card p-5 xl:sticky xl:top-6" data-testid="month-inspector">
            <div className="flex items-start justify-between gap-3 border-b pb-3.5">
              <div>
                <h3 className="text-base font-bold">{formatDayLabel(agenda.date)}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {windows.length
                    ? `שעות פעילות: ${windows.map((w) => `${fmt(w.from)}–${fmt(w.to)}`).join(" · ")}`
                    : "סגור לפי שעות הפעילות"}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setView("day")} data-testid="inspector-open-day">
                מעבר ליום המלא
              </Button>
            </div>

            {appts.filter((a) => a.status !== "cancelled").length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("agenda.noAppointments")}</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-background">
                {appts
                  .filter((a) => a.status !== "cancelled")
                  .map((a) => (
                    <li key={a.id} className="grid gap-1.5 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold tabular-nums"><bdi>{fmt(a.start)}–{fmt(a.end)}</bdi></span>
                        <span className="text-xs text-muted-foreground">{a.service}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{a.customer}</span>
                        <bdi className="text-xs text-muted-foreground">{a.phone}</bdi>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 pt-1">
                        {rowActions(a)}
                      </div>
                    </li>
                  ))}
              </ul>
            )}

            <Button
              onClick={() => {
                dismissAllToasts();
                setDialog({ open: true, time: windows[0] ? fmt(windows[0].from) : "09:00", date: agenda.date });
              }}
              className="w-full"
            >
              <Plus aria-hidden />
              הוספת תור ליום זה
            </Button>
          </aside>
        </div>
      )}

      {moving ? (
        <MoveDialog
          id={moving.id}
          customer={moving.customer}
          date={agenda.date}
          start={moving.start}
          people={agenda.people}
          personId={moving.personId}
          windows={agenda.windows}
          onClose={() => setMoving(null)}
          onDone={(d) => (d === agenda.date ? void reload() : go(d))}
        />
      ) : null}
      {offering ? (
        <OfferDialog
          entry={offering}
          windows={agenda.windows}
          onClose={() => setOffering(null)}
          onDone={() => void reload()}
        />
      ) : null}

      {dialog.open ? (
        <ManualDialog
          open
          onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
          services={agenda.services}
          people={agenda.people}
          defaultPerson={agenda.person ?? ""}
          date={dialog.date ?? agenda.date}
          time={dialog.time}
          windows={agenda.windows}
          onCreated={(d) => (d === agenda.date ? void reload() : go(d))}
        />
      ) : null}
    </div>
  );
}
