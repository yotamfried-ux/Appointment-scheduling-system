"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { fmt, type DashboardAction, type LabAppointment } from "@/lib/lab/dashboard-data";

export function ApprovalsPanel({ appointments, dispatch, notify }: { appointments: LabAppointment[]; dispatch: (a: DashboardAction) => void; notify: (title: string, desc: string, variant: "success" | "info" | "warning") => void }) {
  const t = useTranslations("owner.approvals");
  const pending = appointments.filter((a) => a.status === "pending");
  const requests = appointments.filter((a) => a.status === "cancellationRequested");
  const total = pending.length + requests.length;

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
          {pending.map((a) => (
            <li key={a.id} className="grid gap-3 px-4 py-4" data-testid={`approval-${a.id}`}>
              <div>
                <p className="font-medium">{a.customer}</p>
                <p className="text-sm text-muted-foreground">
                  {a.service} · <bdi>{fmt(a.start)}</bdi>
                  {a.note ? <> · {a.note}</> : null}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" aria-label={`${t("approve")} · ${a.customer}`} onClick={() => { dispatch({ type: "approve", id: a.id }); notify(t("approved"), t("approvedDesc", { name: a.customer }), "success"); }}>
                  <Check aria-hidden />{t("approve")}
                </Button>
                <Button size="sm" variant="outline" aria-label={`${t("reject")} · ${a.customer}`} onClick={() => { dispatch({ type: "reject", id: a.id }); notify(t("rejected"), t("rejectedDesc", { time: fmt(a.start) }), "info"); }}>
                  <X aria-hidden />{t("reject")}
                </Button>
              </div>
            </li>
          ))}
          {requests.map((a) => (
            <li key={a.id} className="grid gap-3 bg-warning-soft/40 px-4 py-4" data-testid={`approval-${a.id}`}>
              <div>
                <p className="text-xs font-semibold text-warning">{t("cancelRequest")}</p>
                <p className="font-medium">{a.customer}</p>
                <p className="text-sm text-muted-foreground">
                  {a.service} · <bdi>{fmt(a.start)}</bdi>
                  {a.note ? <> · {a.note}</> : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive" aria-label={`${t("approveCancel")} · ${a.customer}`} onClick={() => { dispatch({ type: "approveCancellation", id: a.id }); notify(t("cancelled"), t("cancelledDesc", { time: fmt(a.start) }), "warning"); }}>
                  {t("approveCancel")}
                </Button>
                <Button size="sm" variant="outline" aria-label={`${t("keep")} · ${a.customer}`} onClick={() => { dispatch({ type: "declineCancellation", id: a.id }); notify(t("kept"), t("keptDesc", { name: a.customer }), "info"); }}>
                  {t("keep")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
