"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/** Two steps on purpose: erasing a person cannot be undone, so the first click only asks. */
export function AnonymizeCustomer({ id, name }: { id: string; name: string }) {
  const t = useTranslations("customers.detail");
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/customers/${id}/anonymize`, { method: "POST" });
      if (res.status === 409) {
        toast(t("anonymizeUpcoming"), { variant: "warning" });
        setAsking(false);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      toast(t("anonymizeDone"), { variant: "success" });
      router.refresh();
    } catch {
      toast(t("anonymizeError"), { variant: "warning" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="danger" className="grid gap-3 rounded-lg border border-destructive/30 bg-card p-4">
      <div>
        <h2 id="danger" className="text-lg font-semibold">{t("dangerTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("dangerDesc")}</p>
      </div>
      {asking ? (
        <div role="group" aria-label={t("anonymizeConfirm", { name })} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("anonymizeConfirm", { name: `⁨${name}⁩` })}</span>
          <Button variant="destructive" size="sm" disabled={busy} onClick={run} data-testid="anonymize-yes">{t("anonymizeYes")}</Button>
          <Button variant="outline" size="sm" onClick={() => setAsking(false)}>{t("anonymizeNo")}</Button>
        </div>
      ) : (
        <div><Button variant="outline" onClick={() => setAsking(true)} data-testid="anonymize">{t("anonymize")}</Button></div>
      )}
    </section>
  );
}
