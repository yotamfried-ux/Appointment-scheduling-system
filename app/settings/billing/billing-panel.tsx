"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { BillingView } from "@/modules/billing/service";

const money = (cents: number) => new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(cents / 100);
const day = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso)).split("-").reverse().join(".");
const signature = (b: BillingView) => `${b.state}|${b.status}|${b.planId}|${b.currentPeriodEnd}|${b.cancelAtPeriodEnd}`;
const TONE: Record<BillingView["state"], string> = { trial: "bg-info-soft text-info-soft-foreground", active: "bg-success-soft text-success-soft-foreground", grace: "bg-warning-soft text-warning-soft-foreground", degraded: "bg-destructive-soft text-destructive-soft-foreground" };

export function BillingPanel({ initial, timezone }: { initial: BillingView; timezone: string }) {
  const t = useTranslations("billing");
  const router = useRouter();
  const returned = useSearchParams().get("checkout") === "return";
  const [b, setB] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  // BIL-04: coming back from the payment page proves nothing. We wait for the webhook to change the state, and say so.
  const [waiting, setWaiting] = useState<"processing" | "late" | null>(returned ? "processing" : null);
  const baseline = useRef(signature(initial));

  const reload = useCallback(async () => {
    const res = await fetch("/api/owner/billing", { cache: "no-store" });
    if (res.status === 401) return router.replace("/auth/login");
    if (res.ok) setB((await res.json()) as BillingView);
  }, [router]);

  useEffect(() => {
    if (waiting !== "processing") return;
    const started = Date.now();
    const timer = setInterval(async () => {
      await reload();
      if (Date.now() - started > 60_000) setWaiting("late");
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, reload]);
  useEffect(() => {
    if (waiting === "processing" && signature(b) !== baseline.current) {
      setWaiting(null);
      toast(t("processed"), { variant: "success" });
      router.replace("/settings/billing");
    }
  }, [b, waiting, router, t]);

  async function post(path: string, body?: unknown) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
  async function choose(planId: string) {
    if (busy) return;
    setBusy(planId);
    try {
      const r = (await post("/api/owner/billing/checkout", { planId })) as { kind: "redirect"; url: string } | { kind: "manual"; message: string };
      if (r.kind === "redirect") window.location.assign(r.url);
      else setManual(r.message);
    } catch {
      toast(t("checkoutError"), { variant: "warning" });
    } finally {
      setBusy(null);
    }
  }
  async function portal() {
    if (busy) return;
    setBusy("portal");
    try {
      const r = (await post("/api/owner/billing/portal")) as { portal: { url: string } | null };
      if (r.portal) window.location.assign(r.portal.url);
    } catch {
      toast(t("portalError"), { variant: "warning" });
    } finally {
      setBusy(null);
    }
  }

  const limit = b.limits.maxServices;
  const over = limit !== null && b.usage.services > limit;
  const current = b.plans.find((p) => p.id === b.planId);

  return (
    <div className="grid gap-6" data-testid="billing" data-state={b.state}>
      {waiting === "processing" ? (
        <div role="status" aria-busy="true" className="rounded-lg border border-info/40 bg-info-soft p-4 text-info-soft-foreground" data-testid="billing-processing">
          <p className="font-semibold">{t("processing")}</p>
          <p className="text-sm">{t("processingHint")}</p>
        </div>
      ) : null}
      {waiting === "late" ? <p role="status" className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm font-medium text-warning-soft-foreground" data-testid="billing-late">{t("processingLate")}</p> : null}

      <section aria-labelledby="current" className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="current" className="text-sm text-muted-foreground">{t("current")}</h2>
            <p className="text-2xl font-bold tracking-tight" data-testid="billing-plan">{b.planName}</p>
          </div>
          <Badge className={TONE[b.state]} data-testid="billing-state">{t(`state.${b.state}`)}</Badge>
        </div>
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {b.state === "trial" && b.trialEndsAt ? <li>{t("trialEnds", { date: day(b.trialEndsAt, timezone) })}</li> : null}
          {b.status === "canceled" && b.currentPeriodEnd ? <li>{t("cancelsOn", { date: day(b.currentPeriodEnd, timezone) })}</li> : b.status === "active" && b.currentPeriodEnd ? <li>{t("periodEnds", { date: day(b.currentPeriodEnd, timezone) })}</li> : null}
          {b.state === "grace" && b.graceUntil ? <li>{t("graceUntil", { date: day(b.graceUntil, timezone) })}</li> : null}
        </ul>
        <div className="grid gap-1 border-t pt-3 text-sm">
          <p className="text-muted-foreground">{t("services")}</p>
          <p className="font-semibold tabular-nums" data-testid="billing-usage">{limit === null ? t("servicesUnlimited", { used: b.usage.services }) : t("servicesOf", { used: b.usage.services, limit })}</p>
          {over ? <p className="text-warning-soft-foreground" role="note" data-testid="billing-over">{t("overQuota")}</p> : null}
        </div>
        {b.canManage && b.providerName !== "manual" && b.status !== "trialing" ? (
          <div><Button variant="outline" disabled={busy !== null} onClick={portal} data-testid="billing-portal">{t("portal")}</Button></div>
        ) : null}
      </section>

      {b.providerName === "manual" || manual ? (
        <p className="rounded-lg border bg-card p-4 text-sm" data-testid="billing-manual"><span className="font-semibold">{t("manualTitle")}. </span>{manual ?? t("manualDesc")}</p>
      ) : null}

      <section aria-labelledby="plans" className="grid gap-3">
        <h2 id="plans" className="text-lg font-semibold">{t("plans")}</h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {b.plans.map((p) => {
            const isCurrent = p.id === b.planId && b.state !== "degraded";
            const upgrade = current ? p.priceCents > current.priceCents : true;
            return (
              <li key={p.id} className={`grid content-start gap-3 rounded-lg border bg-card p-4 sm:p-5 ${isCurrent ? "border-primary ring-1 ring-primary/30" : ""}`} data-testid={`plan-${p.id}`}>
                <div>
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <p className="text-sm text-muted-foreground tabular-nums">{t("perMonth", { price: money(p.priceCents) })}</p>
                </div>
                <ul className="grid gap-1 text-sm">
                  <li>{p.features.maxServices === null ? t("feature.servicesUnlimited") : t("feature.services", { count: p.features.maxServices })}</li>
                  <li className={p.features.waitlist ? "" : "text-muted-foreground line-through"}>{t("feature.waitlist")}</li>
                  <li className={p.features.export ? "" : "text-muted-foreground line-through"}>{t("feature.export")}</li>
                </ul>
                {isCurrent ? (
                  <Button variant="outline" disabled>{t("thisPlan")}</Button>
                ) : b.canManage ? (
                  <Button variant={upgrade ? "default" : "outline"} disabled={busy !== null} onClick={() => choose(p.id)} data-testid={`choose-${p.id}`}>{upgrade ? t("chooseUpgrade") : t("chooseDowngrade")}</Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!b.canManage ? <p className="text-sm text-muted-foreground">{t("managerOnly")}</p> : null}
      </section>
    </div>
  );
}
