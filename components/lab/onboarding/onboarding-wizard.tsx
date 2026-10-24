"use client";

import { ArrowRight, Check, Copy, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { FormField } from "@/components/patterns/form-field";
import { HoursEditor } from "@/components/patterns/hours-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { normalizePhone } from "@/lib/phone";
import { KIND_IDS, type BusinessKindId } from "@/modules/tenancy/business-kind";
import {
  BUSINESS_TYPES,
  canContinueOnboarding,
  kindServices,
  initialOnboarding,
  onboardingReducer,
  suggestSlug,
  ONBOARDING_STEPS,
} from "@/lib/lab/onboarding";
import { cn } from "@/lib/utils";

const VISIBLE = ONBOARDING_STEPS.slice(0, 3) as ("business" | "services" | "hours")[];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];


type FinishResult = { ok: true; slug: string; published?: boolean } | { ok: false; code: string };

/**
 * Lab mode (no props): prototype, nothing is saved. Real mode (`onFinish`): the last step saves through a Server Action
 * and the done screen shows the slug the server actually assigned.
 */
export function OnboardingWizard({ onFinish, email, host }: { onFinish?: (payload: unknown) => Promise<FinishResult>; email?: string; host?: string } = {}) {
  const t = useTranslations("onboarding");
  const [s, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [s.step]);

  const stepIndex = VISIBLE.indexOf(s.step as (typeof VISIBLE)[number]);
  const slug = savedSlug ?? customSlug ?? suggestSlug(s.business.name);
  const slugInvalid = customSlug !== null && !(customSlug.length >= 3 && customSlug.length <= 40 && SLUG_RE.test(customSlug));
  const link = `${host ?? "tori.example"}/book/${slug}`;
  const next = async () => {
    if (saving) return;
    setTouched(true);
    if (!canContinueOnboarding(s) || slugInvalid) return;
    if (s.step === "hours" && onFinish) {
      setSaving(true);
      setSaveError(null);
      try {
        const r = await onFinish({
          name: s.business.name,
          kind: s.business.type,
          phone: s.business.phone,
          ...(customSlug ? { slug: customSlug } : {}),
          services: s.services.map(({ name, durationMinutes, priceNis }) => ({ name, durationMinutes, priceNis })),
          hours: s.hours,
        });
        if (!r.ok) {
          setSaveError(r.code === "BUSINESS_LIMIT" ? t("submit.errors.limit") : r.code === "NOT_AUTHENTICATED" ? t("submit.errors.session") : r.code === "VALIDATION" || r.code === "SLUG_INVALID" ? t("submit.errors.validation") : r.code === "SLUG_TAKEN" ? t("submit.errors.slug") : t("submit.errors.generic"));
          return;
        }
        setSavedSlug(r.slug);
        setPublished(r.published === true);
      } catch {
        setSaveError(t("submit.errors.generic"));
        return;
      } finally {
        setSaving(false);
      }
    }
    setTouched(false);
    dispatch({ type: "next" });
  };

  if (s.step === "done") {
    return (
      <Shell email={email}>
        <main id="main" className="mx-auto w-full max-w-xl px-4 py-12 text-center sm:py-16">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50" aria-hidden><Check className="size-8" strokeWidth={3} /></div>
          <h1 ref={heading} tabIndex={-1} className="mt-5 text-3xl font-bold outline-none" data-testid="done-title">{t("done.title")}</h1>
          <p className="mt-1 text-balance text-muted-foreground">{t("done.subtitle")}</p>
<<<<<<< HEAD
          {onFinish && !published ? (
=======
          {onFinish ? (
>>>>>>> origin/main
            <p className="mt-8 rounded-lg border bg-card p-4 text-start text-sm text-muted-foreground" data-testid="publish-hint">{t("done.publishHint")}</p>
          ) : (
            <div className="mt-8 rounded-lg border bg-card p-4 text-start">
              <p className="text-sm text-muted-foreground">{t("done.link")}</p>
              <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]"><bdi data-testid="share-link">{link}</bdi></p>
<<<<<<< HEAD
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  data-testid="copy-link"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`https://${link}`);
                      setCopied(true);
                      toast(t("done.copied"), { variant: "success" });
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      setCopied(false); // the link stays selectable next to the button
                    }
                  }}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{t("done.copy")}
                </Button>
=======
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => toast(t("done.copied"), { variant: "success" })}><Copy aria-hidden />{t("done.copy")}</Button>
>>>>>>> origin/main
              </div>
            </div>
          )}
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
          <Button asChild size="lg" className="mt-8 w-full"><Link href={onFinish ? "/dashboard" : "/design/dashboard"}>{t("done.toDashboard")}</Link></Button>
        </main>
      </Shell>
    );
  }

  return (
    <Shell email={email}>
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
            <FormField label={t("business.type")} hint={t("business.typeHint")}>
              {(a) => (
                <NativeSelect {...a} value={s.business.type} onChange={(e) => dispatch({ type: "setType", kind: e.target.value as BusinessKindId })}>
                  {BUSINESS_TYPES.filter((b) => KIND_IDS.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </NativeSelect>
              )}
            </FormField>
            <FormField label={t("business.phone")} hint={t("business.phoneHint")} error={touched && normalizePhone(s.business.phone) === null ? "מספר הטלפון אינו תקין." : undefined}>
              {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" value={s.business.phone} onChange={(e) => dispatch({ type: "setBusiness", business: { ...s.business, phone: e.target.value } })} />}
            </FormField>
            <FormField label={t("business.link")} hint={t("business.linkHint")} error={slugInvalid ? t("business.linkInvalid") : undefined}>
              {(a) => (
                <div className="flex items-center gap-2" dir="ltr">
                  <span className="shrink-0 text-sm text-muted-foreground">{host ?? "tori.example"}/book/</span>
                  <Input {...a} dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false} data-testid="link-input" value={slug} onChange={(e) => setCustomSlug(e.target.value.trim().toLowerCase())} />
                </div>
              )}
            </FormField>
          </div>
        )}

        {s.step === "services" && (
          <div className="mt-6 grid gap-5">
            {kindServices(s.business.type as BusinessKindId).filter((p) => !s.services.some((x) => x.name === p.name)).length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-muted-foreground">{t("services.suggestions")}</p>
                <div className="flex flex-wrap gap-2">
                  {kindServices(s.business.type as BusinessKindId).filter((p) => !s.services.some((x) => x.name === p.name)).map((p) => (
                    <Button key={p.name} type="button" variant="outline" size="sm" onClick={() => {
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
          <HoursEditor
            className="mt-6"
            hours={s.hours}
            onToggle={(weekday) => dispatch({ type: "toggleDay", weekday })}
            onSet={(weekday, index, from, to) => dispatch({ type: "setHours", weekday, index, from, to })}
            onAdd={(weekday) => dispatch({ type: "addWindow", weekday })}
            onRemove={(weekday, index) => dispatch({ type: "removeWindow", weekday, index })}
          />
        )}
      </main>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          {s.step !== "business" ? (
            <Button type="button" variant="outline" size="lg" onClick={() => dispatch({ type: "back" })} aria-label={t("actions.back")}><ArrowRight aria-hidden /><span className="hidden sm:inline">{t("actions.back")}</span></Button>
          ) : null}
          <div className="grid min-w-0 flex-1 gap-2">
            {saveError ? <p role="alert" data-testid="save-error" className="text-sm font-medium text-destructive">{saveError}</p> : null}
            <Button type="button" size="lg" className="w-full" disabled={saving} onClick={next} data-testid="continue">
              {saving ? t("submit.saving") : s.step === "hours" ? t("actions.finish") : t("actions.continue")}
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, email }: { children: React.ReactNode; email?: string }) {
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60"><div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4"><Logo />{email ? <bdi className="min-w-0 truncate text-sm text-muted-foreground" data-testid="whoami">{email}</bdi> : null}</div></header>
      {children}
    </div>
  );
}
