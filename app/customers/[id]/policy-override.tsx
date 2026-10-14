"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/** BKG-08: shown to admins when the business has a no-show policy and this customer is (or was) caught by it. */
export function PolicyOverride({ id, policy, flagged, override }: { id: string; policy: "warn" | "require_approval" | "block"; flagged: boolean; override: boolean }) {
  const t = useTranslations("customers.policy");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/customers/${id}/policy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ override: next }) });
      if (!res.ok) throw new Error(String(res.status));
      toast(t(next ? "cleared" : "restored"), { variant: "success" });
      router.refresh();
    } catch {
      toast(t("error"), { variant: "warning" });
    } finally {
      setBusy(false);
    }
  }
  const state = override ? "override" : flagged ? policy : "none";
  return (
    <section aria-labelledby="policy-h" className="grid gap-2 rounded-lg border bg-card p-4" data-testid="customer-policy">
      <h2 id="policy-h" className="font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground" data-testid="customer-policy-state">{t(`state.${state}`)}</p>
      {policy !== "warn" && (flagged || override) ? (
        <div>
          <Button variant="outline" disabled={busy} onClick={() => set(!override)} data-testid="customer-policy-toggle">{override ? t("restore") : t("clear")}</Button>
        </div>
      ) : null}
    </section>
  );
}
