"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { enrollTotpAction, verifyTotpAction } from "@/app/auth/mfa-actions";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MfaEnroll({ enrolled }: { enrolled: boolean }) {
  const t = useTranslations("auth.mfa");
  const [state, setState] = useState<"idle" | "scan" | "done">(enrolled ? "done" : "idle");
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The server re-renders this page after the action (enrolled prop flips to true); keep the message about what just happened.
  const [justEnrolled, setJustEnrolled] = useState(false);

  if (state === "done") return <p role="status" data-testid="mfa-status" className="font-medium">{justEnrolled ? t("done") : t("enrolled")}</p>;
  if (state === "idle")
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">{t("notEnrolled")}</p>
        <Button
          data-testid="mfa-start"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await enrollTotpAction();
            setBusy(false);
            if (!r.ok) return setError(t("error"));
            setFactor({ id: r.factorId, qr: r.qr, secret: r.secret });
            setState("scan");
          }}
        >
          {t("start")}
        </Button>
        {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
      </div>
    );
  return (
    <form
      method="post"
      noValidate
      className="mx-auto grid w-full max-w-sm gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await verifyTotpAction({ factorId: factor!.id, code });
        setBusy(false);
        if (!r.ok) return setError(t("invalid"));
        setJustEnrolled(true);
        setState("done");
      }}
    >
      <p className="text-center text-sm text-muted-foreground">{t("scan")}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- QR is an inline data: SVG from the auth server */}
      <img src={factor!.qr} alt={t("qrAlt")} width={176} height={176} className="mx-auto rounded-md border bg-white p-2" />
      <div className="grid gap-1 rounded-md bg-muted px-3 py-2.5 text-center">
        <p className="text-xs text-muted-foreground">{t("secret")}</p>
        <bdi className="font-mono text-sm tracking-wider [overflow-wrap:anywhere]" data-testid="mfa-secret">{factor!.secret}</bdi>
      </div>
      <FormField label={t("code")} error={error ?? undefined}>
        {(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />}
      </FormField>
      <Button type="submit" disabled={busy || code.length !== 6}>{t("confirm")}</Button>
    </form>
  );
}
