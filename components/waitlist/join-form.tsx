"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiClientError, labApi } from "@/lib/api/client";

const FIELD: Record<string, string> = { serviceId: "service", date: "date", window: "window", "window.from": "window", "window.to": "window", "customer.fullName": "name", "customer.phone": "phone", "customer.email": "email" };

export function WaitlistJoinForm({ slug, services, initialService }: { slug: string; services: { id: string; name: string }[]; initialService: string }) {
  const t = useTranslations("waitlist.join");
  const [f, setF] = useState({ service: initialService, date: "", from: "", to: "", name: "", phone: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ url: string; created: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    if (!f.service) next.service = t("required");
    if (!f.date) next.date = t("required");
    if (!f.name.trim()) next.name = t("required");
    if (!f.phone.trim()) next.phone = t("required");
    if (!f.email.trim()) next.email = t("required");
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const r = await labApi.joinWaitlist({ kind: "other", session: "public", base: `/api/public/${slug}` }, {
        serviceId: f.service,
        date: f.date,
        ...(f.from && f.to ? { window: { from: f.from, to: f.to } } : {}),
        customer: { fullName: f.name, phone: f.phone, email: f.email },
      });
      setDone({ url: r.manageUrl, created: r.created });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "VALIDATION_FAILED" && err.details.length) setErrors(Object.fromEntries(err.details.map((d) => [FIELD[d.field] ?? "form", d.message])));
      else if (err instanceof ApiClientError && err.code === "WAITLIST_LIMIT") setFormError(t("errors.limit"));
      else if (err instanceof ApiClientError && err.code === "RATE_LIMITED") setFormError(t("errors.rate"));
      else if (err instanceof ApiClientError && err.code === "SERVICE_UNAVAILABLE") setFormError(t("errors.unavailable"));
      else if (err instanceof ApiClientError && err.code === "NOT_FOUND") setFormError(t("errors.closed"));
      else if (err instanceof ApiClientError && err.code === "NETWORK") setFormError(t("errors.network"));
      else setFormError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <section className="grid gap-3 rounded-xl border bg-card p-5" data-testid="waitlist-done">
        <h2 className="text-xl font-bold">{t("done.title")}</h2>
        <p className="text-muted-foreground">{done.created ? t("done.body") : t("done.already")}</p>
        <a href={done.url} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2 [overflow-wrap:anywhere]" data-testid="waitlist-manage-link">{t("done.link")}</a>
      </section>
    );

  return (
    <form onSubmit={submit} noValidate className="grid gap-5" data-testid="waitlist-form">
      <FormField label={t("service")} error={errors.service}>
        {(a) => (
          <NativeSelect {...a} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} data-testid="wl-service">
            <option value="">{t("choose")}</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        )}
      </FormField>
      <FormField label={t("date")} error={errors.date}>
        {(a) => <Input {...a} type="date" dir="ltr" className="text-start" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="wl-date" />}
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="mb-3 text-sm font-medium">{t("window")}</legend>
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
          <FormField label={t("from")}>{(a) => <Input {...a} type="time" step={900} dir="ltr" className="text-start" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} data-testid="wl-from" />}</FormField>
          <FormField label={t("to")} error={errors.window}>{(a) => <Input {...a} type="time" step={900} dir="ltr" className="text-start" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} data-testid="wl-to" />}</FormField>
        </div>
        <p className="text-sm text-muted-foreground">{t("windowHint")}</p>
      </fieldset>
      <FormField label={t("name")} error={errors.name}>
        {(a) => <Input {...a} autoComplete="name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="wl-name" />}
      </FormField>
      <FormField label={t("phone")} error={errors.phone}>
        {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" className="text-start" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="wl-phone" />}
      </FormField>
      <FormField label={t("email")} hint={t("emailHint")} error={errors.email}>
        {(a) => <Input {...a} type="email" inputMode="email" autoComplete="email" dir="ltr" className="text-start" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="wl-email" />}
      </FormField>
      {formError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive" data-testid="wl-error">{formError}</p> : null}
      <Button type="submit" size="lg" disabled={busy} data-testid="wl-submit">{busy ? t("submitting") : t("submit")}</Button>
    </form>
  );
}
