"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { AuthCard, FormError } from "@/components/auth/auth-card";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authErrorKey } from "@/lib/auth/errors";
import { forgotSchema } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const schema = useMemo(() => forgotSchema((k) => tv(k)), [tv]);
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setServerError(null);
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (error) throw error;
      setSent(true); // same message whether or not the account exists (no enumeration, ACC-02)
    } catch (e) {
      setServerError(t(`errors.${authErrorKey(e)}`));
    }
  });

  if (sent) {
    return (
      <AuthCard title={t("forgot.sentTitle")} description={t("forgot.sentBody")}>
        <Button asChild variant="outline" size="lg">
          <Link href="/auth/login">{t("forgot.backToLogin")}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("forgot.title")}
      description={t("forgot.description")}
      footer={
        <Link href="/auth/login" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("forgot.backToLogin")}
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={serverError} />
        <FormField label={t("email")} error={errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" placeholder={t("emailPlaceholder")} {...register("email")} />}
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("forgot.submitting") : t("forgot.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
