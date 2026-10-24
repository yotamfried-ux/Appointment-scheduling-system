"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { TermsAcceptanceBox, useTermsAcceptance } from "@/components/legal/terms-acceptance";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiClientError, labApi } from "@/lib/api/client";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { cn } from "@/lib/utils";

const FIELD: Record<string, string> = { serviceId: "service", date: "date", window: "window", "window.from": "window", "window.to": "window", "customer.fullName": "name", "customer.phone": "phone", "customer.email": "email", acceptedTerms: "terms", "acceptedTerms.terms": "terms", "acceptedTerms.privacy": "terms" };

const MAX_DAYS = 3; // the same limit the server enforces (WAITLIST_LIMIT)

type Day = { date: string; closed: boolean; freeSlots: number };

export function WaitlistJoinForm({ slug, services, initialService, today, horizonDays }: { slug: string; services: { id: string; name: string }[]; initialService: string; today: string; horizonDays: number }) {
  const t = useTranslations("waitlist.join");
  const [f, setF] = useState({ service: initialService, from: "", to: "", name: "", phone: "", email: "" });
  const [picked, setPicked] = useState<string[]>([]);
  const [manualDate, setManualDate] = useState("");
  const [days, setDays] = useState<{ status: "idle" | "loading" | "error" } | { status: "ready"; list: Day[] }>({ status: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const terms = useTermsAcceptance();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ joined: { date: string; url: string | null; created: boolean }[]; failed: string[] } | null>(null);
  const idemKeys = useRef(new Map<string, string>()); // one proof per day: that this browser created that entry
  const keyFor = (date: string) => {
    if (!idemKeys.current.has(date)) idemKeys.current.set(date, crypto.randomUUID());
    return idemKeys.current.get(date)!;
  };

  // The days to suggest: every open day the business takes bookings for, the full ones first. The customer never has to remember a date.
  useEffect(() => {
    if (!f.service) return;
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on service change
    setDays({ status: "loading" });
    labApi
      .availability({ kind: "other", session: "public", base: `/api/public/${slug}`, signal: ctl.signal }, { service: f.service, from: today, days: Math.min(31, Math.max(1, horizonDays + 1)) })
      .then((r) => {
        setDays({ status: "ready", list: r.days.filter((d) => !d.closed) });
        setPicked((p) => p.filter((d) => r.days.some((x) => x.date === d && !x.closed)));
      })
      .catch((e) => (e instanceof DOMException ? undefined : setDays({ status: "error" })));
    return () => ctl.abort();
  }, [slug, f.service, today, horizonDays]);

  const list = days.status === "ready" ? days.list : [];
  const full = list.filter((d) => d.freeSlots === 0);
  const room = list.filter((d) => d.freeSlots > 0);
  const manual = days.status === "error" || (days.status === "ready" && list.length === 0);
  const toggle = (date: string) => setPicked((p) => (p.includes(date) ? p.filter((d) => d !== date) : p.length >= MAX_DAYS ? p : [...p, date]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    if (!f.service) next.service = t("required");
    const dates = manual ? (manualDate ? [manualDate] : []) : picked;
    if (dates.length === 0) next.date = t(manual ? "required" : "pickDay");
    if (!f.name.trim()) next.name = t("required");
    if (!f.phone.trim()) next.phone = t("required");
    if (!f.email.trim()) next.email = t("required");
    if (!terms.ok) next.terms = terms.requiredMessage;
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    const joined: { date: string; url: string | null; created: boolean }[] = [];
    try {
      for (const date of dates) {
        const r = await labApi.joinWaitlist({ kind: "other", session: "public", base: `/api/public/${slug}` }, {
          serviceId: f.service,
          date,
          ...(f.from && f.to ? { window: { from: f.from, to: f.to } } : {}),
          customer: { fullName: f.name, phone: f.phone, email: f.email },
          acceptedTerms: terms.payload,
        }, keyFor(date));
        terms.remember();
        joined.push({ date, url: r.manageUrl ?? null, created: r.created });
      }
      setDone({ joined, failed: [] });
    } catch (err) {
      const message =
        err instanceof ApiClientError && err.code === "VALIDATION_FAILED" && err.details.length ? null
        : err instanceof ApiClientError && err.code === "WAITLIST_LIMIT" ? t("errors.limit")
        : err instanceof ApiClientError && err.code === "RATE_LIMITED" ? t("errors.rate")
        : err instanceof ApiClientError && err.code === "SERVICE_UNAVAILABLE" ? t("errors.unavailable")
        : err instanceof ApiClientError && err.code === "NOT_FOUND" ? t("errors.closed")
        : err instanceof ApiClientError && err.code === "NETWORK" ? t("errors.network")
        : t("errors.generic");
      if (joined.length > 0) setDone({ joined, failed: dates.slice(joined.length) });
      else if (message === null && err instanceof ApiClientError) setErrors(Object.fromEntries(err.details.map((d) => [FIELD[d.field] ?? "form", d.message])));
      else setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <section className="grid gap-3 rounded-xl border bg-card p-5" data-testid="waitlist-done">
        <h2 className="text-xl font-bold">{t("done.title")}</h2>
        <p className="text-muted-foreground">{done.joined.some((j) => j.created) ? t("done.body") : t("done.already")}</p>
        <ul className="grid gap-2">
          {done.joined.map((j) => (
            <li key={j.date} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5" data-testid={`waitlist-joined-${j.date}`}>
              <span className="font-medium">{formatDayLabel(j.date, "short")}</span>
              {j.url ? <a href={j.url} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2 [overflow-wrap:anywhere]" data-testid="waitlist-manage-link">{t("done.link")}</a> : <span className="text-sm text-muted-foreground" data-testid="waitlist-no-link">{t("done.noLink")}</span>}
            </li>
          ))}
        </ul>
        {done.failed.length ? <p role="alert" className="text-sm font-medium text-destructive" data-testid="wl-partial">{t("done.partial", { days: done.failed.map((d) => formatDayLabel(d, "short")).join(", ") })}</p> : null}
      </section>
    );

  return (
    <form method="post" onSubmit={submit} noValidate className="grid gap-5" data-testid="waitlist-form">
      <FormField label={t("service")} error={errors.service}>
        {(a) => (
          <NativeSelect {...a} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} data-testid="wl-service">
            <option value="">{t("choose")}</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        )}
      </FormField>
      {manual ? (
        <FormField label={t("date")} error={errors.date}>
          {(a) => <Input {...a} type="date" dir="ltr" className="text-start" value={manualDate} min={today} onChange={(e) => setManualDate(e.target.value)} data-testid="wl-date" />}
        </FormField>
      ) : (
        <fieldset className="grid gap-3" data-testid="wl-days" aria-describedby="wl-days-hint">
          <legend className="mb-1 text-sm font-medium">{t("days")}</legend>
          <p id="wl-days-hint" className="text-sm text-muted-foreground">{f.service ? t("daysHint", { max: MAX_DAYS }) : t("pickService")}</p>
          {days.status === "loading" ? <p role="status" aria-busy="true" className="text-sm text-muted-foreground">{t("daysLoading")}</p> : null}
          {days.status === "ready" && full.length === 0 ? <p className="rounded-lg border bg-card px-3 py-2.5 text-sm" data-testid="wl-no-full">{t("noFull")}</p> : null}
          {[{ key: "full", items: full }, { key: "room", items: room }].map((g) =>
            g.items.length ? (
              <div key={g.key} className="grid gap-2">
                <p className="text-xs font-semibold text-muted-foreground">{t(g.key === "full" ? "fullDays" : "roomDays")}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid={`wl-group-${g.key}`}>
                  {g.items.map((d) => {
                    const on = picked.includes(d.date);
                    const blocked = !on && picked.length >= MAX_DAYS;
                    return (
                      <label key={d.date} className={cn("relative flex min-h-14 cursor-pointer flex-col justify-center rounded-lg border bg-card px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", on && "border-primary bg-accent", blocked && "cursor-not-allowed opacity-50")}>
                        <input type="checkbox" className="peer sr-only" checked={on} disabled={blocked} onChange={() => toggle(d.date)} data-testid={`wl-day-${d.date}`} />
                        <span className="font-semibold">{formatDayLabel(d.date, "short")}</span>
                        <span className={cn("text-xs", d.freeSlots === 0 ? "font-semibold" : "text-muted-foreground")}>{d.freeSlots === 0 ? t("dayFull") : t("dayRoom")}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null,
          )}
          {errors.date ? <p role="alert" className="text-sm font-medium text-destructive" data-testid="wl-date-error">{errors.date}</p> : null}
          {room.length > 0 ? <a href={`/book/${slug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-2">{t("bookInstead")}</a> : null}
        </fieldset>
      )}
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
      {terms.needed ? <TermsAcceptanceBox checked={terms.checked} onChange={(v) => { terms.setChecked(v); setErrors((e) => ({ ...e, terms: "" })); }} error={errors.terms || undefined} testId="wl-terms" /> : null}
      {formError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive" data-testid="wl-error">{formError}</p> : null}
      <Button type="submit" size="lg" disabled={busy} data-testid="wl-submit">{busy ? t("submitting") : t("submit")}</Button>
    </form>
  );
}
