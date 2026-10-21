"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { changeSlugAction, checkSlugAction } from "@/app/settings/actions";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const VALID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
type Check = "idle" | "checking" | "available" | "taken" | "invalid" | "rate" | "error";

/** The short name in the booking link. `prefix` is the address up to the name, e.g. "https://turim.example.com/book/". */
export function BookingLinkForm({ prefix, initial }: { prefix: string; initial: string }) {
  const t = useTranslations("settings.link");
  const [current, setCurrent] = useState(initial);
  const [value, setValue] = useState(initial);
  const [remote, setRemote] = useState<{ name: string; state: Check } | null>(null);
  const [result, setResult] = useState<"idle" | "saved" | "tooMany" | "forbidden" | "taken" | "error">("idle");
  const [pending, start] = useTransition();
  const name = value.trim().toLowerCase();
  const syntaxOk = name.length >= 3 && name.length <= 40 && VALID.test(name);
  // Decided on the spot: unchanged, empty or malformed. Only a well-formed new name needs the server's answer.
  const local: Check | null = name === current ? "idle" : !syntaxOk ? (name === "" ? "idle" : "invalid") : null;
  const check: Check = local ?? (remote?.name === name ? remote.state : "checking");

  useEffect(() => {
    if (local) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const r = await checkSlugAction(name);
      if (stale) return;
      setRemote({ name, state: r.ok ? (r.available ? "available" : "taken") : r.code === "RATE_LIMITED" ? "rate" : r.code === "VALIDATION" ? "invalid" : "error" });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [name, local]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult("idle");
    start(async () => {
      const r = await changeSlugAction(name);
      if (r.ok) {
        setCurrent(r.slug);
        setValue(r.slug);
        setResult("saved");
      } else setResult(r.code === "SLUG_TAKEN" ? "taken" : r.code === "TOO_MANY_CHANGES" ? "tooMany" : r.code === "FORBIDDEN" ? "forbidden" : "error");
    });
  };

  const message = result === "saved" ? t("saved") : result === "tooMany" ? t("tooMany") : result === "forbidden" ? t("forbidden") : result === "taken" ? t("taken") : result === "error" ? t("error") : null;
  const hint = check === "checking" ? t("checking") : check === "available" ? t("available") : null;
  const error = check === "invalid" ? t("invalid") : check === "taken" ? t("taken") : check === "rate" ? t("rate") : check === "error" ? t("error") : undefined;

  return (
    <form method="post" onSubmit={submit} noValidate className="grid max-w-xl gap-4" data-testid="booking-link-form">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("lead")}</p>
        <p className="text-sm">
          {t("current")}: <bdi dir="ltr" className="font-medium" data-testid="link-current">{`${prefix}${current}`}</bdi>
        </p>
      </div>
      <FormField label={t("label")} hint={hint ?? t("hint")} error={error}>
        {(a) => (
          <div className="flex items-center gap-2" dir="ltr">
            <span className="shrink-0 text-sm text-muted-foreground">{prefix}</span>
            <Input {...a} value={value} maxLength={40} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => { setValue(e.target.value); setResult("idle"); }} data-testid="link-input" />
          </div>
        )}
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || name === current || check !== "available"} data-testid="link-save">
          {pending ? t("saving") : t("save")}
        </Button>
        {message ? <p role="status" className="text-sm" data-testid="link-status">{message}</p> : null}
      </div>
    </form>
  );
}
