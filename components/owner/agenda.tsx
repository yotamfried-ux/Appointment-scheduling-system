"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { z } from "zod";
import { TimeRibbon } from "@/components/brand/time-ribbon";
import { ApprovalsPanel, type ApprovalAction } from "@/components/lab/dashboard/approvals-panel";
import { DaySchedule } from "@/components/lab/dashboard/day-schedule";
import { StatStrip } from "@/components/lab/dashboard/stat-strip";
import { ManualDialog } from "@/components/owner/manual-dialog";
import { OfferDialog } from "@/components/owner/offer-dialog";
import { WaitlistPanel, type WaitlistEntry } from "@/components/owner/waitlist-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dismissAllToasts, toast } from "@/components/ui/toast";
import { ApiClientError, ownerApi } from "@/lib/api/client";
import type * as C from "@/lib/api/contracts";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { dashboardReducer, fmt, gapsIn, ribbonIn, statsIn, type LabAppointment } from "@/lib/lab/dashboard-data";
import { addDaysIso } from "@/modules/availability/slots";

type Agenda = z.infer<typeof C.OwnerAgendaResponse>;
type Action = z.infer<typeof C.OwnerAction>;
const toLab = (a: Agenda["appointments"][number]): LabAppointment => a;

/** The owner's working day: who is coming, what needs a decision, what is free. Truth lives on the server; the UI moves first and rolls back on refusal. */
export function OwnerAgenda() {
  const t = useTranslations("owner");
  const router = useRouter();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [load, setLoad] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; agenda: Agenda }>({ status: "loading" });
  const [state, dispatch] = useReducer(dashboardReducer, { appointments: [] as LabAppointment[] });
  const [inbox, setInbox] = useState<LabAppointment[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; time: string }>({ open: false, time: "" });
  const [offering, setOffering] = useState<WaitlistEntry | null>(null);
  const [pollMs, setPollMs] = useState(10_000);
  const inFlight = useRef(false); // synchronous guard: React state is too late for a fast double click

  const refresh = useCallback(
    async (d: string | undefined, signal?: AbortSignal) => {
      try {
        const agenda = await ownerApi.agenda(d, signal);
        dispatch({ type: "replace", appointments: agenda.appointments.map(toLab) });
        setInbox(agenda.inbox.map(toLab));
        setLoad({ status: "ready", agenda });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ApiClientError && e.code === "UNAUTHENTICATED") return router.replace("/auth/login");
        setLoad((prev) => (prev.status === "ready" ? prev : { status: "error" }));
      }
    },
    [router],
  );
  useEffect(() => {
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the viewed day from the API
    void refresh(date, ctl.signal);
    return () => ctl.abort();
  }, [date, refresh]);

  // Live view (WLT-07): a cheap version check while the tab is visible, an immediate check when it comes back to the front. The interval can be
  // shortened with ?poll=<ms> (500–60000) — used by tests, harmless for anyone else.
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("poll"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the optional ?poll= once on the client
    if (Number.isInteger(n) && n >= 500 && n <= 60_000) setPollMs(n);
  }, []);
  const version = load.status === "ready" ? load.agenda.version : null;
  const viewedDate = load.status === "ready" ? load.agenda.date : date;
  useEffect(() => {
    if (version === null) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || inFlight.current) return;
      try {
        const v = await ownerApi.version();
        if (!stopped && v !== version && !inFlight.current) void refresh(viewedDate);
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
  }, [version, viewedDate, pollMs, refresh]);

  const current = load.status === "ready" ? load.agenda.date : date;
  const reload = () => refresh(current);

  async function act(action: Action, a: LabAppointment, success: [string, "success" | "info" | "warning"]) {
    if (inFlight.current) return; // one decision at a time: the list reflows, a second tap would land on someone else
    inFlight.current = true;
    setBusy((b) => new Set(b).add(a.id));
    setConfirming(null);
    dispatch({ type: action, id: a.id });
    if (action === "approve" || action === "reject" || action === "approveCancellation" || action === "declineCancellation" || action === "cancel") setInbox((l) => l.filter((x) => x.id !== a.id));
    try {
      await ownerApi.transition(a.id, action);
      toast(success[0], { variant: success[1] });
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "UNAUTHENTICATED") router.replace("/auth/login");
      else toast(e instanceof ApiClientError && e.code === "INVALID_TRANSITION" ? t("agenda.errStale") : e instanceof ApiClientError && e.code === "TOO_EARLY" ? t("agenda.errTooEarly") : t("agenda.errAction"), { variant: "warning" });
      await reload(); // back to what the server says
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
  const windows = agenda.windows;
  const appts = state.appointments;
  const stats = statsIn(appts, windows);
  const freeMinutes = gapsIn(appts, windows, 30).reduce((s, g) => s + (g.end - g.start), 0);
  const isPast = agenda.date < agenda.today;
  const started = (a: LabAppointment) => isPast || (agenda.now !== null && a.start <= agenda.now);
  const from = windows[0]?.from ?? 0;
  const to = windows.at(-1)?.to ?? 0;
  const go = (d: string) => setDate(d);

  const rowActions = (a: LabAppointment) => {
    if (a.status !== "confirmed") return null;
    const off = busy.size > 0;
    if (started(a))
      return (
        <>
          <Button size="sm" variant="outline" disabled={off} onClick={() => act("complete", a, [t("agenda.toastCompleted"), "success"])} data-testid={`complete-${a.id}`}>{t("agenda.complete")}</Button>
          <Button size="sm" variant="outline" disabled={off} onClick={() => act("noShow", a, [t("agenda.toastNoShow"), "info"])} data-testid={`noshow-${a.id}`}>{t("agenda.noShow")}</Button>
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
    return <Button size="sm" variant="outline" disabled={off} onClick={() => setConfirming(a.id)} data-testid={`cancel-${a.id}`}>{t("agenda.cancel")}</Button>;
  };

  return (
    <div className="grid min-w-0 gap-8 [&>*]:min-w-0" data-testid="agenda">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight" data-testid="agenda-title">{formatDayLabel(agenda.date)}</h2>
          {isPast ? <p className="mt-1 text-sm text-muted-foreground">{t("agenda.pastHint")}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label={t("agenda.prev")} onClick={() => go(addDaysIso(agenda.date, -1))} data-testid="day-prev"><ChevronRight aria-hidden /></Button>
          <Button variant="outline" disabled={agenda.date === agenda.today} onClick={() => go(agenda.today)} data-testid="day-today">{t("agenda.today")}</Button>
          <Button variant="outline" size="icon" aria-label={t("agenda.next")} onClick={() => go(addDaysIso(agenda.date, 1))} data-testid="day-next"><ChevronLeft aria-hidden /></Button>
          <Input type="date" dir="ltr" className="h-11 w-auto text-start" aria-label={t("agenda.goTo")} value={agenda.date} onChange={(e) => e.target.value && go(e.target.value)} data-testid="day-input" />
          <Button onClick={() => { dismissAllToasts(); setDialog({ open: true, time: "" }); }} data-testid="new-appointment"><Plus aria-hidden />{t("agenda.newAppointment")}</Button>
        </div>
      </div>

      {agenda.undelivered > 0 ? (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm font-medium text-warning-soft-foreground" data-testid="undelivered">
          {t("agenda.undelivered", { count: agenda.undelivered })}
        </p>
      ) : null}

      <StatStrip
        stats={[
          { label: t("stats.appointments"), value: String(stats.total), hint: t("stats.confirmedHint", { count: appts.filter((a) => a.status === "confirmed" || a.status === "completed").length }) },
          { label: t("stats.pending"), value: String(inbox.length), hint: t("stats.pendingHint"), tone: inbox.length > 0 ? "attention" : "default" },
          { label: t("stats.occupancy"), value: `${stats.occupancyPct}%`, hint: t("stats.occupancyHint") },
          { label: t("stats.free"), value: `${Math.floor(freeMinutes / 60)}:${String(freeMinutes % 60).padStart(2, "0")}`, hint: t("stats.freeHint") },
        ]}
      />

      <section aria-labelledby="overview-title" className="grid gap-3">
        <h3 id="overview-title" className="text-base font-semibold">{t("today.overview")}</h3>
        <div className="rounded-lg border bg-card p-4 sm:p-5">
          {windows.length ? (
            <TimeRibbon from={from} to={to} segments={ribbonIn(appts, windows)} now={agenda.now ?? undefined} height="lg" tickEvery={to - from > 600 ? 2 : 1} legend />
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="closed-today">{appts.length ? t("agenda.closedWithManual") : t("agenda.closed")}</p>
          )}
        </div>
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] [&>*]:min-w-0">
        <section aria-labelledby="schedule-title" className="grid gap-3">
          <h3 id="schedule-title" className="text-base font-semibold">{t("today.schedule")}</h3>
          {appts.some((a) => a.status !== "cancelled") || windows.length ? (
            <DaySchedule appointments={appts} windows={windows} now={agenda.now} renderActions={rowActions} onAddInGap={(start) => { dismissAllToasts(); setDialog({ open: true, time: fmt(start) }); }} />
          ) : (
            <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="no-appointments">{t("agenda.noAppointments")}</p>
          )}
        </section>
        <div className="order-first grid gap-6 lg:order-none">
          <ApprovalsPanel appointments={inbox} onAction={onApproval} busyIds={busy} />
          <WaitlistPanel
            entries={agenda.waitlist}
            settings={agenda.settings}
            busy={busy.size > 0}
            onOffer={(e) => setOffering(e)}
            onRemove={(e) => waitlistRun(() => ownerApi.waitlistRemove(e.id), t("waitlist.toastRemoved"))}
            onSettings={(patch) => waitlistRun(() => ownerApi.waitlistSettings(patch), t("waitlist.toastEnabled"))}
          />
        </div>
      </div>

      {offering ? <OfferDialog entry={offering} onClose={() => setOffering(null)} onDone={() => void reload()} /> : null}

      {dialog.open ? (
        <ManualDialog
          open
          onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
          services={agenda.services}
          date={agenda.date}
          time={dialog.time}
          onCreated={(d) => (d === agenda.date ? void reload() : go(d))}
        />
      ) : null}
    </div>
  );
}
