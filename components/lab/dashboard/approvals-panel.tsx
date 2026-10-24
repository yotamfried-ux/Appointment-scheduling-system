"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { fmt, type DashboardAction, type LabAppointment } from "@/lib/lab/dashboard-data";

export type ApprovalAction = Exclude<DashboardAction["type"], "replace" | "cancel" | "complete" | "noShow">;

export function ApprovalsPanel({ appointments, onAction, busyIds }: { appointments: LabAppointment[]; onAction: (action: ApprovalAction, a: LabAppointment) => void; busyIds: ReadonlySet<string> }) {
  const when = (a: LabAppointment) => (a.date ? <>{formatDayLabel(a.date, "short")} · <bdi>{fmt(a.start)}</bdi></> : <bdi>{fmt(a.start)}</bdi>);
  const t = useTranslations("owner.approvals");
  const pending = appointments.filter((a) => a.status === "pending");
  const requests = appointments.filter((a) => a.status === "cancellationRequested");
  const total = pending.length + requests.length;
  // With many waiting requests the panel shows the first few; the rest is one click away, so it never pushes the day's schedule off the page.
  const [all, setAll] = useState(false);
  const LIMIT = 4;
  const shownPending = all ? pending : pending.slice(0, Math.max(0, LIMIT - requests.length));

  return (
    <section aria-labelledby="approvals-title" className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3.5">
        <h2 id="approvals-title" className="text-base font-semibold">{t("title")}</h2>
        <span className="min-w-6 rounded-full bg-foreground px-2 py-0.5 text-center text-xs font-semibold text-background tabular-nums" data-testid="approvals-count" aria-label={`${total}`}>{total}</span>
      </div>
      {total === 0 ? (
        <div className="px-4 py-8 text-center" data-testid="approvals-empty">
          <p className="font-medium">{t("empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        <ul className="divide-y">
          {shownPending.map((a) => (
            <li key={a.id} className="grid min-w-0 gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center xl:grid-cols-1" data-testid={`approval-${a.id}`}>
              <div>
                <p className="font-medium [overflow-wrap:anywhere]">{a.customer}</p>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {a.service} · {when(a)}
                  {a.note ? <> · {a.note}</> : null}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" aria-label={`${t("approve")} · ${a.customer}`} disabled={busyIds.size > 0} onClick={() => onAction("approve", a)}>
                  <Check aria-hidden />{t("approve")}
                </Button>
                <Button size="sm" variant="outline" aria-label={`${t("reject")} · ${a.customer}`} disabled={busyIds.size > 0} onClick={() => onAction("reject", a)}>
                  <X aria-hidden />{t("reject")}
                </Button>
              </div>
            </li>
          ))}
          {requests.map((a) => (
            <li key={a.id} className="grid min-w-0 gap-3 bg-warning-soft/40 px-4 py-4" data-testid={`approval-${a.id}`}>
              <div>
                <p className="text-xs font-semibold text-warning">{t("cancelRequest")}</p>
                <p className="font-medium [overflow-wrap:anywhere]">{a.customer}</p>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {a.service} · {when(a)}
                  {a.note ? <> · {a.note}</> : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive" aria-label={`${t("approveCancel")} · ${a.customer}`} disabled={busyIds.size > 0} onClick={() => onAction("approveCancellation", a)}>
                  {t("approveCancel")}
                </Button>
                <Button size="sm" variant="outline" aria-label={`${t("keep")} · ${a.customer}`} disabled={busyIds.size > 0} onClick={() => onAction("declineCancellation", a)}>
                  {t("keep")}
                </Button>
              </div>
            </li>
          ))}
          {pending.length > shownPending.length || (all && pending.length > Math.max(0, LIMIT - requests.length)) ? (
            <li className="px-4 py-2.5">
              <Button type="button" variant="ghost" size="sm" className="w-full" aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="approvals-more">
                {all ? t("showFewer") : t("showAll", { count: total })}
              </Button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
