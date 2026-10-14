"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { waitlistAction } from "@/app/waitlist/[token]/actions";
import { Button } from "@/components/ui/button";

type Kind = "accept" | "decline" | "leave";

export function WaitlistActions({ tokens, offerActive, canLeave }: { tokens: { accept: string | null; decline: string | null; leave: string | null }; offerActive: boolean; canLeave: boolean }) {
  const t = useTranslations("waitlist.page");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<Kind | null>(null);

  const run = (kind: Kind) =>
    start(async () => {
      setBusyKind(kind);
      const token = tokens[kind];
      const r = token ? await waitlistAction(kind, token) : "invalid";
      setBusyKind(null);
      if (r === "accepted" || r === "declined" || r === "left") return router.refresh();
      setMessage(t(`results.${r}`));
      setConfirmLeave(false);
      router.refresh(); // new action links for whatever the state is now
    });

  return (
    <div className="grid gap-3">
      {message ? <p role="alert" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm font-medium text-warning-soft-foreground" data-testid="wl-result">{message}</p> : null}
      {offerActive ? (
        <div className="grid gap-2">
          <Button size="lg" disabled={pending} onClick={() => run("accept")} data-testid="wl-accept">{busyKind === "accept" ? t("offer.accepting") : t("offer.accept")}</Button>
          <Button size="lg" variant="outline" disabled={pending} onClick={() => run("decline")} data-testid="wl-decline">{busyKind === "decline" ? t("offer.declining") : t("offer.decline")}</Button>
        </div>
      ) : null}
      {canLeave && !offerActive ? (
        confirmLeave ? (
          <div role="group" aria-label={t("leaveConfirm")} className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="font-semibold">{t("leaveConfirm")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" disabled={pending} onClick={() => run("leave")} data-testid="wl-leave-confirm">{t("leaveYes")}</Button>
              <Button variant="outline" disabled={pending} onClick={() => setConfirmLeave(false)}>{t("leaveNo")}</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="lg" disabled={pending} onClick={() => setConfirmLeave(true)} data-testid="wl-leave">{t("leave")}</Button>
        )
      ) : null}
    </div>
  );
}
