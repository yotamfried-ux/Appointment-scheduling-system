"use client";

import { Link2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useReducer } from "react";
import { TimeRibbon } from "@/components/brand/time-ribbon";
import { AppSidebar } from "@/components/lab/dashboard/app-sidebar";
import { ApprovalsPanel } from "@/components/lab/dashboard/approvals-panel";
import { DaySchedule } from "@/components/lab/dashboard/day-schedule";
import { StatStrip } from "@/components/lab/dashboard/stat-strip";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import { computeGaps, dashboardReducer, initialDashboard, LAB_DAY, todayStats, toRibbon } from "@/lib/lab/dashboard-data";

const WAITLIST = 3;

export function DashboardView() {
  const t = useTranslations("owner");
  const [state, dispatch] = useReducer(dashboardReducer, initialDashboard);
  const stats = todayStats(state.appointments, LAB_DAY.from, LAB_DAY.to);
  const gaps = computeGaps(state.appointments, LAB_DAY.from, LAB_DAY.to, 30);
  const freeMinutes = gaps.reduce((s, g) => s + (g.end - g.start), 0);

  const notify = (title: string, description: string, variant: "success" | "info" | "warning") => toast(title, { description, variant });

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
              <p className="text-sm text-muted-foreground">{t("today.greeting")}</p>
              <h1 className="text-3xl font-bold tracking-tight">{t("today.title")}</h1>
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
              <TimeRibbon from={LAB_DAY.from} to={LAB_DAY.to} segments={toRibbon(state.appointments, LAB_DAY.from, LAB_DAY.to)} now={LAB_DAY.now} height="lg" tickEvery={1} legend />
            </div>
          </section>

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section aria-labelledby="schedule-title" className="grid gap-3">
              <h2 id="schedule-title" className="text-base font-semibold">{t("today.schedule")}</h2>
              <DaySchedule appointments={state.appointments} onAddInGap={(start) => toast(t("gap.add"), { variant: "info", description: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}` })} />
            </section>
            <div className="order-first grid gap-6 lg:order-none">
              <ApprovalsPanel appointments={state.appointments} dispatch={dispatch} notify={notify} />
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
