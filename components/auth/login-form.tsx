"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { AuthCard, FormError } from "@/components/auth/auth-card";
import { FormField } from "@/components/patterns/form-field";
import { PasswordInput } from "@/components/patterns/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authErrorKey } from "@/lib/auth/errors";
import { loginSchema } from "@/lib/auth/schemas";
import { loginAction } from "@/app/auth/actions";

export function LoginForm({ verified = false }: { verified?: boolean }) {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = useMemo(() => loginSchema((k) => tv(k)), [tv]);
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setServerError(null);
    try {
      const r = await loginAction({ email, password });
      if (!r.ok) return setServerError(t(`errors.${r.errorKey}`));
      router.push(r.mfaRequired ? "/auth/mfa" : "/dashboard");
      router.refresh();
    } catch (e) {
      setServerError(t(`errors.${authErrorKey(e)}`));
    }
  });

  return (
    <AuthCard
      title={t("login.title")}
      description={verified ? t("login.verifiedNotice") : t("login.description")}
      footer={
        <>
          {t("login.noAccount")}{" "}
          <Link href="/auth/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("login.signUpLink")}
          </Link>
        </>
      }
    >
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={serverError} />
        <FormField label={t("email")} error={errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" placeholder={t("emailPlaceholder")} {...register("email")} />}
        </FormField>
        <FormField label={t("password")} error={errors.password?.message}>
          {(a) => <PasswordInput {...a} autoComplete="current-password" {...register("password")} />}
        </FormField>
        <div className="-mt-2 text-end text-sm">
          <Link href="/auth/forgot-password" className="text-primary underline-offset-4 hover:underline">
            {t("forgotPassword")}
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
