"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AccountPanel({ businessName, isOwner, pendingDate }: { businessName: string; isOwner: boolean; pendingDate: string | null }) {
  const t = useTranslations("settings.account");
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call(body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/owner/account/deletion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 422) setMessage(t("mismatch"));
      else if (!res.ok) setMessage(t("error"));
      else { setName(""); router.refresh(); }
    } catch {
      setMessage(t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (!isOwner) return <p className="text-muted-foreground" data-testid="account-owner-only">{t("ownerOnly")}</p>;

  return (
    <div className="grid max-w-xl gap-8">
      <section aria-labelledby="exp-h" className="grid gap-2">
        <h2 id="exp-h" className="text-lg font-semibold">{t("exportTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("exportBody")}</p>
        <div><Button asChild variant="outline" size="lg"><a href="/api/owner/account/export" download data-testid="account-export">{t("exportButton")}</a></Button></div>
      </section>

      <section aria-labelledby="del-h" className="grid gap-3 rounded-lg border border-destructive/40 p-4">
        <h2 id="del-h" className="text-lg font-semibold">{t("deleteTitle")}</h2>
        {pendingDate ? (
          <>
            <p role="status" data-testid="account-deletion-pending">{t("pending", { date: pendingDate })}</p>
            <div><Button variant="outline" disabled={busy} onClick={() => call({ action: "cancel" })} data-testid="account-deletion-cancel">{t("cancelDeletion")}</Button></div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("deleteBody")}</p>
            <ul className="list-disc ps-5 text-sm text-muted-foreground">
              <li>{t("effect1")}</li>
              <li>{t("effect2")}</li>
              <li>{t("effect3")}</li>
            </ul>
            <FormField label={t("typeName", { name: `⁨${businessName}⁩` })}>
              {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="account-confirm-name" />}
            </FormField>
            <div><Button variant="destructive" disabled={busy || name.trim() !== businessName} onClick={() => call({ action: "request", confirmName: name })} data-testid="account-delete">{t("deleteButton")}</Button></div>
          </>
        )}
        {message ? <p role="alert" className="text-sm font-medium text-destructive" data-testid="account-error">{message}</p> : null}
      </section>
    </div>
  );
}
