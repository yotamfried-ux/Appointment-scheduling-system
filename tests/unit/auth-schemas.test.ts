import { describe, expect, it } from "vitest";
import { loginSchema, MIN_PASSWORD_LENGTH, signUpSchema, updatePasswordSchema } from "@/lib/auth/schemas";

const t = (key: string) => key;

describe("auth schemas & password requirements", () => {
  it("MIN_PASSWORD_LENGTH is 6", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
  });

  describe("signUpSchema", () => {
    const schema = signUpSchema(t);

    it("rejects password shorter than 6 characters", () => {
      const res = schema.safeParse({
        email: "user@example.com",
        password: "ab1",
        repeatPassword: "ab1",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.message === "passwordShort")).toBe(true);
      }
    });

    it("rejects password containing Hebrew characters with dedicated message", () => {
      const res = schema.safeParse({
        email: "user@example.com",
        password: "יותם1235",
        repeatPassword: "יותם1235",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.message === "passwordNoHebrew")).toBe(true);
      }
    });

    it("rejects password with letters only (no numbers)", () => {
      const res = schema.safeParse({
        email: "user@example.com",
        password: "abcdef",
        repeatPassword: "abcdef",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.message === "passwordComplexity")).toBe(true);
      }
    });

    it("rejects password with numbers only (no letters)", () => {
      const res = schema.safeParse({
        email: "user@example.com",
        password: "123456",
        repeatPassword: "123456",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.message === "passwordComplexity")).toBe(true);
      }
    });

    it("accepts valid password with at least 6 characters combining letters and numbers", () => {
      const res = schema.safeParse({
        email: "user@example.com",
        password: "pass12",
        repeatPassword: "pass12",
      });
      expect(res.success).toBe(true);
    });

    it("rejects password mismatch", () => {
      const res = schema.safeParse({
        email: "user@example.com",
        password: "pass12",
        repeatPassword: "pass99",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.message === "passwordMismatch")).toBe(true);
      }
    });
  });

  describe("updatePasswordSchema", () => {
    const schema = updatePasswordSchema(t);

    it("enforces 6 characters, rejects Hebrew, and requires letter + number combination", () => {
      expect(schema.safeParse({ password: "12345" }).success).toBe(false);
      expect(schema.safeParse({ password: "abcdef" }).success).toBe(false);
      expect(schema.safeParse({ password: "123456" }).success).toBe(false);
      expect(schema.safeParse({ password: "יותם1235" }).success).toBe(false);
      expect(schema.safeParse({ password: "pass12" }).success).toBe(true);
    });
  });
});
