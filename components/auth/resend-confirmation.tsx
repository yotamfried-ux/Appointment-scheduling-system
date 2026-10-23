"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resendConfirmationAction } from "@/app/auth/actions";

/** Shown when a verification link has expired: the customer asks for a new one without starting over. */
export function ResendConfirmation() {
  const t = useTranslations("auth.resend");
  const te = useTranslations("auth.errors");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t("invalid"));
    setState("sending");
    try {
      const r = await resendConfirmationAction({ email });
      if (!r.ok) {
        setState("idle");
        return setError(r.errorKey === "over_request_rate_limit" ? te("over_request_rate_limit") : t("failed"));
      }
      setState("sent");
    } catch {
      setState("idle");
      setError(t("failed"));
    }
  }

  if (state === "sent") {
    return (
      <p role="status" className="rounded-lg bg-info-soft p-4 text-sm text-info-soft-foreground" data-testid="resend-sent">
        {t("sent")}
      </p>
    );
  }
  return (
    <form method="post" onSubmit={submit} className="grid gap-3" noValidate data-testid="resend-form">
      <FormField label={t("email")} error={error ?? undefined}>
        {(a) => <Input {...a} type="email" inputMode="email" autoComplete="email" dir="ltr" className="text-start" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="resend-email" />}
      </FormField>
      <Button type="submit" size="lg" disabled={state === "sending"} data-testid="resend-submit">
        {state === "sending" ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
