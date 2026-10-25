import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 6; // keep in sync with supabase/config.toml [auth].minimum_password_length

const HAS_LETTER = /[a-zA-Z]/;
const HAS_NUMBER = /[0-9]/;
const HAS_HEBREW = /[\u0590-\u05FF]/;

type T = (key: string) => string;

export const loginSchema = (t: T) =>
  z.object({
    email: z.string().min(1, t("emailRequired")).pipe(z.email(t("emailInvalid"))),
    password: z.string().min(1, t("passwordRequired")),
  });

function refinePassword(t: T) {
  return z
    .string()
    .min(MIN_PASSWORD_LENGTH, t("passwordShort"))
    .superRefine((v, ctx) => {
      if (HAS_HEBREW.test(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t("passwordNoHebrew"),
        });
        return;
      }
      if (!HAS_LETTER.test(v) || !HAS_NUMBER.test(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t("passwordComplexity"),
        });
      }
    });
}

export const signUpSchema = (t: T) =>
  z
    .object({
      email: z.string().min(1, t("emailRequired")).pipe(z.email(t("emailInvalid"))),
      password: refinePassword(t),
      repeatPassword: z.string(),
    })
    .refine((v) => v.password === v.repeatPassword, { path: ["repeatPassword"], message: t("passwordMismatch") });

export const forgotSchema = (t: T) =>
  z.object({ email: z.string().min(1, t("emailRequired")).pipe(z.email(t("emailInvalid"))) });

export const updatePasswordSchema = (t: T) =>
  z.object({
    password: refinePassword(t),
  });
