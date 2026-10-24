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

/** The day is read in three parts, whatever the business does: before noon, noon to 16:00, and from 16:00. */
const part = (minute: number) => (minute < 12 * 60 ? "morning" : minute < 16 * 60 ? "noon" : "evening");

export function DaySchedule({ appointments, windows, now, onAddInGap, renderActions, showPerson = false, showGaps = true }: { appointments: LabAppointment[]; windows: Window[]; now: number | null; onAddInGap: (start: number) => void; renderActions?: (a: LabAppointment) => React.ReactNode; showPerson?: boolean; showGaps?: boolean }) {
  const t = useTranslations();
  const rows: Row[] = [
    ...appointments.filter((a) => a.status !== "cancelled").map((a): Row => ({ kind: "appt", start: a.start, a })),
    ...(showGaps ? gapsIn(appointments, windows, 30) : []).map((g): Row => ({ kind: "gap", start: g.start, end: g.end })),
  ].sort((x, y) => x.start - y.start);
  const count = (p: string) => rows.filter((r) => r.kind === "appt" && part(r.start) === p).length;

  const seenParts = new Set<string>();
  const firstOfPart = new Set<Row>();
  for (const r of rows) {
    const p = part(r.start);
    if (!seenParts.has(p)) {
      seenParts.add(p);
      firstOfPart.add(r);
    }
  }
  return (
    <ol className="overflow-hidden rounded-xl border bg-card" data-testid="schedule">
      {rows.flatMap((r) => {
        const out: React.ReactNode[] = [];
        const p = part(r.start);
        if (firstOfPart.has(r)) {
          out.push(
            <li key={`part-${p}`} aria-hidden className="flex items-baseline justify-between border-b bg-muted/50 px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground" data-testid={`part-${p}`}>
              <span>{t(`owner.today.part.${p}`)}</span>
              <span className="tabular-nums">{count(p)}</span>
            </li>,
          );
        }
        if (r.kind === "appt") {
          const a = r.a;
          const isNow = now !== null && a.start <= now && now < a.end;
          out.push(
            <li key={a.id} className={cn("grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0 hover:bg-accent/30 lg:grid-cols-[4.25rem_minmax(0,1fr)_auto_auto]", a.status === "completed" && "text-muted-foreground", isNow && "bg-accent/40")} data-testid={`row-${a.id}`} data-status={a.status}>
              <div className="leading-tight tabular-nums">
                <bdi className="block text-lg font-semibold">{fmt(a.start)}</bdi>
                <bdi className="block text-xs text-muted-foreground">{fmt(a.end)}</bdi>
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{a.customer}</span>
                  {isNow ? <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{t("owner.today.now")}</span> : null}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {showPerson && a.personName ? <span data-testid={`person-of-${a.id}`} className="font-medium text-foreground">{a.personName} · </span> : null}
                  {a.service}
                  {a.manual ? <> · {t("owner.agenda.manualTag")}</> : null}
                  {a.outOfHours ? <> · <span className="font-medium text-warning-soft-foreground">{t("owner.agenda.outOfHoursTag")}</span></> : null}
                  {a.note ? <> · {a.note}</> : null}
                </p>
              </div>
              <StatusBadge status={STATUS_MAP[a.status].badge} label={t(`status.${STATUS_MAP[a.status].key}`)} />
              {renderActions?.(a) ? <div className="col-span-3 flex flex-wrap gap-2 ps-[calc(4.25rem+1rem)] lg:col-span-1 lg:ps-0">{renderActions(a)}</div> : null}
            </li>,
          );
        } else {
          out.push(
            <li key={`gap-${r.start}`} className="grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-dashed bg-success-soft/40 px-4 py-2 last:border-b-0" data-testid={`gap-${fmt(r.start)}`}>
              <bdi className="text-sm font-semibold tabular-nums text-success">{fmt(r.start)}</bdi>
              <p className="text-sm text-success-soft-foreground">
                <span className="font-semibold">{t("owner.gap.label")}</span> · {formatDuration(r.end - r.start)}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => onAddInGap(r.start)}>
                <Plus aria-hidden />
                {t("owner.gap.add")}
              </Button>
            </li>,
          );
        }
        return out;
      })}
    </ol>
  );
}
