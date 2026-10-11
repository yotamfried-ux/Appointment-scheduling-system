"use client";

import { Link2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { z } from "zod";
import { TimeRibbon } from "@/components/brand/time-ribbon";
import { AppSidebar } from "@/components/lab/dashboard/app-sidebar";
import { ApprovalsPanel, type ApprovalAction } from "@/components/lab/dashboard/approvals-panel";
import { DaySchedule } from "@/components/lab/dashboard/day-schedule";
import { StatStrip } from "@/components/lab/dashboard/stat-strip";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import { ApiClientError, labApi, resolveSession, type ClientOptions } from "@/lib/api/client";
import type * as C from "@/lib/api/contracts";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { dashboardReducer, fmt, gapsIn, ribbonIn, statsIn, type LabAppointment } from "@/lib/lab/dashboard-data";
import type { BusinessKindId } from "@/modules/tenancy/business-kind";

type Agenda = z.infer<typeof C.AppointmentsResponse>;

const WAITLIST = 3;

export function DashboardView({ kind, session: sessionParam }: { kind: BusinessKindId; session?: string }) {
  const t = useTranslations("owner");
  const [session] = useState(() => resolveSession(sessionParam));
  const opts = useMemo<ClientOptions>(() => ({ kind, session }), [kind, session]);
  const [load, setLoad] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; agenda: Agenda; business: string }>({ status: "loading" });
  const [state, dispatch] = useReducer(dashboardReducer, { appointments: [] as LabAppointment[] });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>()); // synchronous guard: state updates are too late for a fast double click

  const refresh = useCallback(async () => {
    try {
      const [agenda, catalog] = await Promise.all([labApi.appointments(opts), labApi.services(opts)]);
      dispatch({ type: "replace", appointments: agenda.appointments });
      setLoad({ status: "ready", agenda, business: catalog.business.name });
    } catch {
      setLoad((prev) => (prev.status === "ready" ? prev : { status: "error" }));
    }
  }, [opts]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch from the API
    void refresh();
  }, [refresh]);

  const notify = (title: string, description: string, variant: "success" | "info" | "warning") => toast(title, { description, variant });

  // Optimistic update with rollback: the UI moves first, the API decides. A rejected transition restores the server truth.
  async function onAction(action: ApprovalAction, a: LabAppointment) {
    // One action at a time: the list reflows optimistically, so a fast second tap would land on the NEXT person's button.
    if (inFlight.current.size > 0) return;
    inFlight.current.add(a.id);
    setBusy((b) => new Set(b).add(a.id));
    dispatch({ type: action, id: a.id });
    try {
      await labApi.transition(opts, a.id, action);
      const copy = {
        approve: [t("approvals.approved"), t("approvals.approvedDesc", { name: a.customer }), "success"],
        reject: [t("approvals.rejected"), t("approvals.rejectedDesc", { time: fmt(a.start) }), "info"],
        approveCancellation: [t("approvals.cancelled"), t("approvals.cancelledDesc", { time: fmt(a.start) }), "warning"],
        declineCancellation: [t("approvals.kept"), t("approvals.keptDesc", { name: a.customer }), "info"],
      }[action] as [string, string, "success" | "info" | "warning"];
      notify(...copy);
    } catch (e) {
      toast(e instanceof ApiClientError && e.code === "INVALID_TRANSITION" ? t("errors.stale") : t("errors.action"), { variant: "warning" });
      await refresh(); // roll back to what the server says
    } finally {
      inFlight.current.delete(a.id);
      setBusy((b) => {
        const n = new Set(b);
        n.delete(a.id);
        return n;
      });
    }
  }

  if (load.status === "error") {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-4 text-center" data-testid="dash-load-error">
        <h1 className="text-2xl font-bold">{t("errors.load")}</h1>
        <Button onClick={() => { setLoad({ status: "loading" }); void refresh(); }}>{t("errors.retry")}</Button>
      </main>
    );
  }
  if (load.status === "loading") {
    return (
      <main id="main" className="mx-auto flex min-h-svh items-center justify-center px-4" aria-busy="true">
        <p role="status" className="text-muted-foreground">{t("loading")}</p>
      </main>
    );
  }

  const { agenda, business } = load;
  const windows = agenda.windows;
  const stats = statsIn(state.appointments, windows);
  const gaps = gapsIn(state.appointments, windows, 30);
  const freeMinutes = gaps.reduce((s, g) => s + (g.end - g.start), 0);
  const from = windows[0]?.from ?? 0;
  const to = windows.at(-1)?.to ?? 0;

  return (
    <SidebarProvider>
      <AppSidebar waitlistCount={WAITLIST} />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <p className="text-sm font-medium text-muted-foreground">{t("nav.today")}</p>
          <div className="ms-auto flex items-center gap-2">
            <ThemeSwitcher />
            <Button size="sm" onClick={() => toast(t("header.newAppointment"), { variant: "info" })}>
              <Plus aria-hidden />
              {t("header.newAppointment")}
            </Button>
          </div>
        </header>

        <main id="main" className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:py-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground" data-testid="dash-business">{business}</p>
              <h1 className="text-3xl font-bold tracking-tight">{formatDayLabel(agenda.date)}</h1>
            </div>
            <Button variant="outline" onClick={() => toast(t("header.linkCopied"), { variant: "success", description: t("header.linkCopiedDesc") })}>
              <Link2 aria-hidden />
              {t("header.copyLink")}
            </Button>
          </div>

          <StatStrip
            stats={[
              { label: t("stats.appointments"), value: String(stats.total), hint: t("stats.confirmedHint", { count: state.appointments.filter((a) => a.status === "confirmed" || a.status === "completed").length }) },
              { label: t("stats.pending"), value: String(stats.pending + stats.cancellationRequests), hint: t("stats.pendingHint"), tone: stats.pending + stats.cancellationRequests > 0 ? "attention" : "default" },
              { label: t("stats.occupancy"), value: `${stats.occupancyPct}%`, hint: t("stats.occupancyHint") },
              { label: t("stats.free"), value: `${Math.floor(freeMinutes / 60)}:${String(freeMinutes % 60).padStart(2, "0")}`, hint: t("stats.freeHint") },
            ]}
          />

          <section aria-labelledby="overview-title" className="grid gap-3">
            <h2 id="overview-title" className="text-base font-semibold">{t("today.overview")}</h2>
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              {windows.length ? (
                <TimeRibbon from={from} to={to} segments={ribbonIn(state.appointments, windows)} now={agenda.now} height="lg" tickEvery={to - from > 600 ? 2 : 1} legend />
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="closed-today">{t("errors.closedToday")}</p>
              )}
            </div>
          </section>

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section aria-labelledby="schedule-title" className="grid gap-3">
              <h2 id="schedule-title" className="text-base font-semibold">{t("today.schedule")}</h2>
              <DaySchedule appointments={state.appointments} windows={windows} now={agenda.now} onAddInGap={(start) => toast(t("gap.add"), { variant: "info", description: fmt(start) })} />
            </section>
            <div className="order-first grid gap-6 lg:order-none">
              <ApprovalsPanel appointments={state.appointments} onAction={onAction} busyIds={busy} />
              <section aria-labelledby="wl-title" className="rounded-lg border bg-card p-4">
                <h2 id="wl-title" className="text-base font-semibold">{t("waitlist.title")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("waitlist.body", { count: WAITLIST })}</p>
                <Button className="mt-3" variant="outline" size="sm" onClick={() => toast(t("waitlist.cta"), { variant: "info" })}>{t("waitlist.cta")}</Button>
              </section>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
