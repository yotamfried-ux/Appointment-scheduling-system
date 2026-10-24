"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ApiClientError, ownerApi } from "@/lib/api/client";
import { fmt } from "@/lib/lab/dashboard-data";
import type { WaitlistEntry } from "@/components/owner/waitlist-panel";

/** Offer a specific time to one waiting customer (used when automatic offers are off, or to jump the queue deliberately). */
export function OfferDialog({
  entry,
  windows = [],
  onClose,
  onDone,
}: {
  entry: WaitlistEntry;
  windows?: { from: number; to: number }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("owner.waitlist.offerDialog");
  const [time, setTime] = useState(entry.fromMinute !== null ? fmt(entry.fromMinute) : windows[0] ? fmt(windows[0].from) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!time) return setError(t("required"));
    setBusy(true);
    setError(null);
    try {
      await ownerApi.waitlistOffer(entry.id, time);
      toast(t("sent"), { variant: "success" });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError && (err.code === "SLOT_TAKEN" || err.code === "INVALID_TRANSITION" || err.code === "VALIDATION_FAILED") ? err.message : t("generic"));
    } finally {
      setBusy(false);
    }
  }

  const requestedWindow =
    entry.fromMinute !== null && entry.toMinute !== null ? `${fmt(entry.fromMinute)}–${fmt(entry.toMinute)}` : "כל שעה פנויה";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{t("title", { name: entry.customer })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-card p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">טווח שעות מבוקש על ידי הלקוח:</span>
            <span className="font-semibold tabular-nums" data-testid="offer-requested-window"><bdi>{requestedWindow}</bdi></span>
          </div>
          {windows.length > 0 ? (
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t pt-1.5">
              <span className="text-muted-foreground">שעות פעילות העסק:</span>
              <span className="font-semibold tabular-nums"><bdi>{windows.map((w) => `${fmt(w.from)}–${fmt(w.to)}`).join(" · ")}</bdi></span>
            </div>
          ) : null}
        </div>
        <form method="post" onSubmit={submit} noValidate className="grid gap-4" data-testid="offer-form">
          <FormField label={t("time")} hint={t("hint", { service: entry.service })} error={undefined}>
            {(a) => <Input {...a} type="time" step={300} dir="ltr" className="text-start" value={time} onChange={(e) => setTime(e.target.value)} data-testid="offer-time" />}
          </FormField>
          {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive" data-testid="offer-error">{error}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy} data-testid="offer-submit">{busy ? t("sending") : t("submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
