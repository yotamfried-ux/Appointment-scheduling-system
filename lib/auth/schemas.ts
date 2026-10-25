import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 6; // keep in sync with supabase/config.toml [auth].minimum_password_length

const HAS_LETTER = /[a-zA-Z]/;
const HAS_NUMBER = /[0-9]/;

type T = (key: string) => string;

export const loginSchema = (t: T) =>
  z.object({
    email: z.string().min(1, t("emailRequired")).pipe(z.email(t("emailInvalid"))),
    password: z.string().min(1, t("passwordRequired")),
  });

export const signUpSchema = (t: T) =>
  z
    .object({
      email: z.string().min(1, t("emailRequired")).pipe(z.email(t("emailInvalid"))),
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, t("passwordShort"))
        .refine((v) => HAS_LETTER.test(v) && HAS_NUMBER.test(v), {
          message: t("passwordComplexity"),
        }),
      repeatPassword: z.string(),
    })
    .refine((v) => v.password === v.repeatPassword, { path: ["repeatPassword"], message: t("passwordMismatch") });

export const forgotSchema = (t: T) =>
  z.object({ email: z.string().min(1, t("emailRequired")).pipe(z.email(t("emailInvalid"))) });

export const updatePasswordSchema = (t: T) =>
  z.object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, t("passwordShort"))
      .refine((v) => HAS_LETTER.test(v) && HAS_NUMBER.test(v), {
        message: t("passwordComplexity"),
      }),
  });
