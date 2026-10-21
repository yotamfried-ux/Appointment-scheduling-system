"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { AuthCard, FormError } from "@/components/auth/auth-card";
import { FormField } from "@/components/patterns/form-field";
import { PasswordInput } from "@/components/patterns/password-input";
import { Button } from "@/components/ui/button";
import { authErrorKey } from "@/lib/auth/errors";
import { updatePasswordSchema } from "@/lib/auth/schemas";
import { updatePasswordAction } from "@/app/auth/actions";

export function UpdatePasswordForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = useMemo(() => updatePasswordSchema((k) => tv(k)), [tv]);
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "" } });

  const onSubmit = handleSubmit(async ({ password }) => {
    setServerError(null);
    try {
      const r = await updatePasswordAction({ password });
      if (!r.ok) return setServerError(t(`errors.${r.errorKey}`));
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setServerError(t(`errors.${authErrorKey(e)}`));
    }
  });

  return (
    <AuthCard title={t("update.title")} description={t("update.description")}>
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={serverError} />
        <FormField label={t("newPassword")} hint={t("passwordHint")} error={errors.password?.message}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" {...register("password")} />}
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("update.submitting") : t("update.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
