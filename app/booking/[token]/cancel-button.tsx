"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { cancelAppointmentAction } from "@/app/booking/[token]/actions";
import { Button } from "@/components/ui/button";

export function CancelButton({ token }: { token: string }) {
  const t = useTranslations("manage");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const r = await cancelAppointmentAction(token);
      if (r === "cancelled" || r === "already") return router.refresh();
      setMessage(r === "too_late" ? t("tooLate") : t("invalid"));
      setConfirming(false);
    });

  if (!confirming)
    return (
      <div className="grid gap-2">
        <Button variant="outline" size="lg" className="w-full" data-testid="cancel-start" onClick={() => setConfirming(true)}>
          {t("cancel")}
        </Button>
        {message ? <p role="alert" className="text-sm font-medium text-destructive" data-testid="cancel-error">{message}</p> : null}
      </div>
    );
  return (
    <div role="group" aria-label={t("confirmTitle")} className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p className="font-semibold">{t("confirmTitle")}</p>
      <p className="text-sm text-muted-foreground">{t("confirmBody")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" disabled={pending} data-testid="cancel-confirm" onClick={run}>
          {pending ? t("cancelling") : t("confirm")}
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => setConfirming(false)}>{t("keep")}</Button>
      </div>
    </div>
  );
}
