"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusBadge, type AppointmentStatus } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { fmt, formatDuration, gapsIn, type LabAppointment, type Window } from "@/lib/lab/dashboard-data";
import { cn } from "@/lib/utils";

const STATUS_MAP: Record<LabAppointment["status"], { badge: AppointmentStatus; key: string }> = {
  confirmed: { badge: "confirmed", key: "confirmed" },
  pending: { badge: "pending", key: "pending" },
  completed: { badge: "completed", key: "completed" },
  noShow: { badge: "noShow", key: "noShow" },
  cancelled: { badge: "cancelled", key: "cancelled" },
  cancellationRequested: { badge: "cancellationRequested", key: "cancellationRequested" },
};

type Row = { kind: "appt"; start: number; a: LabAppointment } | { kind: "gap"; start: number; end: number };

export function DaySchedule({ appointments, windows, now, onAddInGap, renderActions }: { appointments: LabAppointment[]; windows: Window[]; now: number | null; onAddInGap: (start: number) => void; renderActions?: (a: LabAppointment) => React.ReactNode }) {
  const t = useTranslations();
  const rows: Row[] = [
    ...appointments.filter((a) => a.status !== "cancelled").map((a): Row => ({ kind: "appt", start: a.start, a })),
    ...gapsIn(appointments, windows, 30).map((g): Row => ({ kind: "gap", start: g.start, end: g.end })),
  ].sort((x, y) => x.start - y.start);

  return (
    <ol className="divide-y rounded-lg border bg-card" data-testid="schedule">
      {rows.map((r) =>
        r.kind === "appt" ? (
          <li key={r.a.id} className={cn("grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5", r.a.status === "completed" && "text-muted-foreground")} data-testid={`row-${r.a.id}`} data-status={r.a.status}>
            <div className="text-sm leading-tight tabular-nums">
              <bdi className="block font-semibold">{fmt(r.a.start)}</bdi>
              <bdi className="block text-xs text-muted-foreground">{fmt(r.a.end)}</bdi>
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate font-medium">
                <span className="truncate">{r.a.customer}</span>
                {now !== null && r.a.start <= now && now < r.a.end ? (
                  <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground">{t("owner.today.now")}</span>
                ) : null}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {r.a.service}
                {r.a.manual ? <> · {t("owner.agenda.manualTag")}</> : null}
                {r.a.outOfHours ? <> · <span className="font-medium text-warning-soft-foreground">{t("owner.agenda.outOfHoursTag")}</span></> : null}
                {r.a.note ? <> · {r.a.note}</> : null}
              </p>
            </div>
            <StatusBadge status={STATUS_MAP[r.a.status].badge} label={t(`status.${STATUS_MAP[r.a.status].key}`)} />
            {renderActions?.(r.a) ? <div className="col-span-3 flex flex-wrap gap-2 ps-[calc(4.5rem+0.75rem)]">{renderActions(r.a)}</div> : null}
          </li>
        ) : (
          <li key={`gap-${r.start}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 bg-success-soft/50 px-4 py-3" data-testid={`gap-${fmt(r.start)}`}>
            <div className="text-sm leading-tight tabular-nums">
              <bdi className="block font-semibold text-success">{fmt(r.start)}</bdi>
              <bdi className="block text-xs text-muted-foreground">{fmt(r.end)}</bdi>
            </div>
            <p className="text-sm text-success-soft-foreground">
              <span className="font-semibold">{t("owner.gap.label")}</span> · {formatDuration(r.end - r.start)}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => onAddInGap(r.start)}>
              <Plus aria-hidden />
              {t("owner.gap.add")}
            </Button>
          </li>
        ),
      )}
    </ol>
  );
}
