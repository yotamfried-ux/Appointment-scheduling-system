"use client";

import { ArrowRight, Check, Copy, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { TimeRibbon } from "@/components/brand/time-ribbon";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { normalizePhone } from "@/lib/phone";
import {
  BUSINESS_TYPES,
  canContinueOnboarding,
  initialOnboarding,
  onboardingReducer,
  suggestSlug,
  ONBOARDING_STEPS,
} from "@/lib/lab/onboarding";
import { cn } from "@/lib/utils";

const VISIBLE = ONBOARDING_STEPS.slice(0, 3) as ("business" | "services" | "hours")[];
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const TIMES = Array.from({ length: 37 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

const PRESETS: Record<string, { name: string; durationMinutes: number; priceNis: number }[]> = {
  barber: [{ name: "תספורת גברים", durationMinutes: 30, priceNis: 80 }, { name: "עיצוב זקן", durationMinutes: 20, priceNis: 40 }],
  beauty: [{ name: "טיפול פנים", durationMinutes: 60, priceNis: 220 }, { name: "הרמת ריסים", durationMinutes: 90, priceNis: 250 }],
  trainer: [{ name: "אימון אישי", durationMinutes: 60, priceNis: 200 }],
  teacher: [{ name: "שיעור פרטי", durationMinutes: 60, priceNis: 150 }],
  clinic: [{ name: "טיפול ראשון", durationMinutes: 60, priceNis: 300 }],
  other: [],
};

export function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const [s, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const [touched, setTouched] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [s.step]);

  const stepIndex = VISIBLE.indexOf(s.step as (typeof VISIBLE)[number]);
  const slug = suggestSlug(s.business.name);
  const link = `tori.example/book/${slug}`;
  const next = () => {
    setTouched(true);
    if (canContinueOnboarding(s)) {
      setTouched(false);
      dispatch({ type: "next" });
    }
  };

  if (s.step === "done") {
    return (
      <Shell>
        <main id="main" className="mx-auto w-full max-w-xl px-4 py-12 text-center sm:py-16">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50" aria-hidden><Check className="size-8" strokeWidth={3} /></div>
          <h1 ref={heading} tabIndex={-1} className="mt-5 text-3xl font-bold outline-none" data-testid="done-title">{t("done.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("done.subtitle")}</p>
          <div className="mt-8 rounded-lg border bg-card p-4 text-start">
            <p className="text-sm text-muted-foreground">{t("done.link")}</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <bdi className="min-w-0 truncate text-lg font-semibold" data-testid="share-link">{link}</bdi>
              <Button variant="outline" onClick={() => toast(t("done.copied"), { variant: "success" })}><Copy aria-hidden />{t("done.copy")}</Button>
            </div>
          </div>
          <div className="mt-8 text-start">
            <p className="mb-3 text-sm font-semibold">{t("done.next")}</p>
            <ul className="divide-y rounded-lg border bg-card">
              {["n1", "n2", "n3"].map((k, i) => (
                <li key={k} className="flex items-center gap-3 px-4 py-3.5">
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", i === 0 ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>{i + 1}</span>
                  <span className={i === 0 ? "font-medium" : "text-muted-foreground"}>{t(`done.${k}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <Button asChild size="lg" className="mt-8 w-full"><Link href="/design/dashboard">{t("done.toDashboard")}</Link></Button>
        </main>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto w-full max-w-xl px-4 pt-6">
        <nav aria-label={t("stepper")}>
          <p className="mb-3 text-sm font-medium text-muted-foreground">{t("stepOf", { current: stepIndex + 1, total: VISIBLE.length })}</p>
          <ol className="grid grid-cols-3 gap-2">
            {VISIBLE.map((k, i) => (
              <li key={k} aria-current={i === stepIndex ? "step" : undefined} className="min-w-0">
                <div className={cn("h-1.5 rounded-full transition-colors duration-200", i <= stepIndex ? "bg-primary" : "bg-border")} />
                <span className={cn("mt-1.5 block truncate text-xs", i === stepIndex ? "font-semibold" : "text-muted-foreground")}>{t(`steps.${k}`)}</span>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <main id="main" className="mx-auto w-full max-w-xl px-4 pt-6 pb-32">
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">{t(`${s.step as "business"}.title`)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(`${s.step as "business"}.subtitle`)}</p>

        {s.step === "business" && (
          <div className="mt-6 grid gap-5">
            <FormField label={t("business.name")} error={touched && s.business.name.trim().length < 2 ? t("services.errors.name") : undefined}>
              {(a) => <Input {...a} autoComplete="organization" value={s.business.name} onChange={(e) => dispatch({ type: "setBusiness", business: { ...s.business, name: e.target.value } })} />}
            </FormField>
            <FormField label={t("business.type")}>
              {(a) => (
                <NativeSelect {...a} value={s.business.type} onChange={(e) => dispatch({ type: "setBusiness", business: { ...s.business, type: e.target.value } })}>
                  {BUSINESS_TYPES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t("business.phone")} hint={t("business.phoneHint")} error={touched && normalizePhone(s.business.phone) === null ? "מספר הטלפון אינו תקין." : undefined}>
              {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" value={s.business.phone} onChange={(e) => dispatch({ type: "setBusiness", business: { ...s.business, phone: e.target.value } })} />}
            </FormField>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">{t("business.link")}</p>
              <bdi className="mt-1 block truncate font-semibold" data-testid="link-preview">{link}</bdi>
              <p className="mt-1 text-xs text-muted-foreground">{t("business.linkHint")}</p>
            </div>
          </div>
        )}

        {s.step === "services" && (
          <div className="mt-6 grid gap-5">
            {(PRESETS[s.business.type] ?? []).length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-muted-foreground">{t("services.suggestions")}</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS[s.business.type].map((p) => (
                    <Button key={p.name} type="button" variant="outline" size="sm" disabled={s.services.some((x) => x.name === p.name)} onClick={() => {
                      const empty = s.services.find((x) => x.name === "" && x.priceNis === 0);
                      if (empty) dispatch({ type: "updateService", id: empty.id, patch: p });
                      else dispatch({ type: "addService", service: p });
                    }}>
                      <Plus aria-hidden />{p.name}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <ul className="grid gap-4">
              {s.services.map((x, i) => (
                <li key={x.id} className="grid gap-3 rounded-lg border bg-card p-4" data-testid={`service-row-${i}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-muted-foreground">{t("services.row", { n: i + 1 })}</p>
                    {s.services.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${t("services.remove")} ${i + 1}`} onClick={() => dispatch({ type: "removeService", id: x.id })}><Trash2 aria-hidden /></Button>
                    ) : null}
                  </div>
                  <FormField label={t("services.name")} error={touched && x.name.trim().length < 2 ? t("services.errors.name") : undefined}>
                    {(a) => <Input {...a} value={x.name} onChange={(e) => dispatch({ type: "updateService", id: x.id, patch: { name: e.target.value } })} />}
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label={t("services.duration")}>
                      {(a) => (
                        <NativeSelect {...a} value={x.durationMinutes} onChange={(e) => dispatch({ type: "updateService", id: x.id, patch: { durationMinutes: Number(e.target.value) } })}>
                          {DURATIONS.map((d) => <option key={d} value={d}>{t("services.minutes", { minutes: d })}</option>)}
                        </NativeSelect>
                      )}
                    </FormField>
                    <FormField label={t("services.price")} error={touched && !(x.priceNis > 0) ? t("services.errors.price") : undefined}>
                      {(a) => <Input {...a} type="number" inputMode="numeric" min={0} value={x.priceNis === 0 ? "" : x.priceNis} onChange={(e) => dispatch({ type: "updateService", id: x.id, patch: { priceNis: Number(e.target.value) } })} />}
                    </FormField>
                  </div>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" onClick={() => dispatch({ type: "addService" })}><Plus aria-hidden />{t("services.add")}</Button>
          </div>
        )}

        {s.step === "hours" && (
          <ul className="mt-6 divide-y rounded-lg border bg-card">
            {s.hours.map((h) => {
              const day = t(`hours.days.${h.weekday}`);
              const invalid = h.open && !(h.from < h.to);
              return (
                <li key={h.weekday} className="grid gap-3 px-4 py-4" data-testid={`hours-${h.weekday}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn("font-semibold", !h.open && "text-muted-foreground")}>{day}</span>
                    {h.open ? null : <span className="text-sm text-muted-foreground">{t("hours.closed")}</span>}
                    <Switch className="ms-auto" checked={h.open} onCheckedChange={() => dispatch({ type: "toggleDay", weekday: h.weekday })} aria-label={t("hours.toggle", { day })} />
                  </div>
                  {h.open ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <NativeSelect aria-label={`${t("hours.from")} ${day}`} value={h.from} onChange={(e) => dispatch({ type: "setHours", weekday: h.weekday, from: e.target.value, to: h.to })}>{TIMES.map((x) => <option key={x}>{x}</option>)}</NativeSelect>
                        <NativeSelect aria-label={`${t("hours.to")} ${day}`} aria-invalid={invalid || undefined} value={h.to} onChange={(e) => dispatch({ type: "setHours", weekday: h.weekday, from: h.from, to: e.target.value })}>{TIMES.map((x) => <option key={x}>{x}</option>)}</NativeSelect>
                      </div>
                      {invalid ? <p role="alert" className="text-sm font-medium text-destructive">{t("hours.error")}</p> : <TimeRibbon from={6 * 60} to={24 * 60} segments={[{ start: toMin(h.from), end: toMin(h.to), state: "free" }]} height="sm" ticks={false} label={`${day} ${h.from}–${h.to}`} />}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {s.step !== "business" ? (
            <Button type="button" variant="outline" size="lg" onClick={() => dispatch({ type: "back" })} aria-label={t("actions.back")}><ArrowRight aria-hidden /><span className="hidden sm:inline">{t("actions.back")}</span></Button>
          ) : null}
          <Button type="button" size="lg" className="flex-1" onClick={next} data-testid="continue">
            {s.step === "hours" ? t("actions.finish") : t("actions.continue")}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60"><div className="mx-auto flex h-14 max-w-xl items-center px-4"><Logo /></div></header>
      {children}
    </div>
  );
}
