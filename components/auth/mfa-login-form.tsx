"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { verifyLoginCodeAction } from "@/app/auth/mfa-actions";
import { AuthCard, FormError } from "@/components/auth/auth-card";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MfaLoginForm() {
  const t = useTranslations("auth.mfa");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <form
        method="post"
        noValidate
        className="grid gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const r = await verifyLoginCodeAction({ code });
          setBusy(false);
          if (!r.ok) return setError(t("invalid"));
          router.push("/dashboard");
          router.refresh();
        }}
      >
        <FormError message={error} />
        <FormField label={t("code")}>
          {(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />}
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== 6}>
          {busy ? t("submitting") : t("submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
