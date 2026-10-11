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
import { signUpSchema } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/client";

export function SignUpForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = useMemo(() => signUpSchema((k) => tv(k)), [tv]);
  type Values = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "", repeatPassword: "" } });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setServerError(null);
    try {
      const { error } = await createClient().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard` },
      });
      if (error) throw error;
      router.push("/auth/sign-up-success");
    } catch (e) {
      setServerError(t(`errors.${authErrorKey(e)}`));
    }
  });

  return (
    <AuthCard
      title={t("signUp.title")}
      description={t("signUp.description")}
      footer={
        <>
          {t("signUp.haveAccount")}{" "}
          <Link href="/auth/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("signUp.loginLink")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={serverError} />
        <FormField label={t("email")} error={errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" placeholder={t("emailPlaceholder")} {...register("email")} />}
        </FormField>
        <FormField label={t("password")} hint={t("passwordHint")} error={errors.password?.message}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" {...register("password")} />}
        </FormField>
        <FormField label={t("repeatPassword")} error={errors.repeatPassword?.message}>
          {(a) => <PasswordInput {...a} autoComplete="new-password" {...register("repeatPassword")} />}
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("signUp.submitting") : t("signUp.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
