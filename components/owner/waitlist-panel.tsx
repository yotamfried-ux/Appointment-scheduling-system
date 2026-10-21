"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import type { z } from "zod";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type * as C from "@/lib/api/contracts";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { fmt } from "@/lib/lab/dashboard-data";
import { cn } from "@/lib/utils";

export type WaitlistEntry = z.infer<typeof C.OwnerWaitlistEntryDto>;

export function WaitlistPanel({ entries, settings, busy, allowed = true, onOffer, onRemove, onSettings }: {
  entries: WaitlistEntry[];
  settings: { waitlistEnabled: boolean; waitlistAutoOffer: boolean };
  busy: boolean;
  /** False when the subscription does not include the waitlist (BIL-08): data stays, the controls become an upsell. */
  allowed?: boolean;
  onOffer: (e: WaitlistEntry) => void;
  onRemove: (e: WaitlistEntry) => void;
  onSettings: (patch: { autoOffer?: boolean; enabled?: boolean }) => void;
}) {
  const t = useTranslations("owner.waitlist");
  const up = useTranslations("billing.upsell");
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <section aria-labelledby="wl-panel-title" className="rounded-lg border bg-card" data-testid="waitlist-panel">
      <div className="flex items-center justify-between border-b px-4 py-3.5">
        <h2 id="wl-panel-title" className="text-base font-semibold">{t("title")}</h2>
        <span className="min-w-6 rounded-full bg-foreground px-2 py-0.5 text-center text-xs font-semibold text-background tabular-nums" data-testid="waitlist-count" aria-label={`${entries.length}`}>{entries.length}</span>
      </div>
      {!allowed ? (
        <div className="grid gap-1 border-b bg-warning-soft px-4 py-3.5 text-sm text-warning-soft-foreground" data-testid="waitlist-upsell">
          <p className="font-semibold">{up("title", { feature: up("waitlist") })}</p>
          <p>{up("desc")}</p>
          <Link href="/settings/billing" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{up("action")}</Link>
        </div>
      ) : (
      <div className="grid gap-3 border-b px-4 py-3.5">
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>{t("enabled")}</span>
          <Switch checked={settings.waitlistEnabled} onCheckedChange={(v) => onSettings({ enabled: v })} aria-label={t("enabled")} data-testid="wl-enabled-switch" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>{t("auto")}<span className="mt-0.5 block text-xs font-normal text-muted-foreground">{settings.waitlistAutoOffer ? t("autoOn") : t("autoOff")}</span></span>
          <Switch checked={settings.waitlistAutoOffer} onCheckedChange={(v) => onSettings({ autoOffer: v })} aria-label={t("auto")} data-testid="wl-auto-switch" />
        </label>
      </div>
      )}
      {entries.length === 0 ? (
        <div className="px-4 py-8 text-center" data-testid="waitlist-empty">
          <p className="font-medium">{t("empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        <ul className="divide-y">
          {entries.map((e) => (
            <li key={e.id} className="grid min-w-0 gap-3 px-4 py-4" data-testid={`wl-${e.id}`} data-status={e.status}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium [overflow-wrap:anywhere]">{e.customer}</p>
                  {e.status === "offered" ? <StatusBadge status="pending" label={t("offered", { time: fmt(e.offer!.expiresMinute) })} /> : null}
                </div>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {e.service} · {formatDayLabel(e.date, "short")} · {e.fromMinute === null || e.toMinute === null ? t("anyTime") : <bdi>{fmt(e.fromMinute)}–{fmt(e.toMinute)}</bdi>}
                </p>
                <p className="text-sm text-muted-foreground"><bdi>{e.phone}</bdi></p>
              </div>
              {confirming === e.id ? (
                <div role="group" aria-label={t("removeConfirm")} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t("removeConfirm")}</span>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => { setConfirming(null); onRemove(e); }} data-testid={`wl-remove-yes-${e.id}`}>{t("removeYes")}</Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>{t("removeNo")}</Button>
                </div>
              ) : (
                <div className={cn("flex flex-wrap gap-2")}>
                  <Button size="sm" disabled={busy || !allowed || e.status === "offered"} onClick={() => onOffer(e)} data-testid={`wl-offer-${e.id}`}>{t("offer")}</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(e.id)} data-testid={`wl-remove-${e.id}`}>{t("remove")}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
