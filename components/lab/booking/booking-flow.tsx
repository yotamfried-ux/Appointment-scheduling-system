"use client";

import { ArrowRight, CalendarPlus, Check, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { TimeRibbon } from "@/components/brand/time-ribbon";
import { useHoldTimer } from "@/components/lab/booking/use-hold-timer";
import { WeekPicker } from "@/components/lab/booking/week-picker";
import { ChoiceCard } from "@/components/patterns/choice-card";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  dayBounds,
  dayPart,
  formatDayLabel,
  formatPrice,
  generateDays,
  generateSlots,
  LAB_SERVICES,
  LAB_TODAY,
  slotSegments,
} from "@/lib/lab/booking-data";
import { bookingReducer, canContinue, detailsValid, initialBookingState, STEP_ORDER, type BookingStep } from "@/lib/lab/booking-flow";
import { normalizePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

const HOLD_SECONDS = 5 * 60;
const VISIBLE_STEPS = STEP_ORDER.slice(0, 4) as Exclude<BookingStep, "done">[];

export function BookingFlow() {
  const t = useTranslations("booking");
  const [s, dispatch] = useReducer(bookingReducer, initialBookingState);
  const [touched, setTouched] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const service = LAB_SERVICES.find((x) => x.id === s.serviceId) ?? null;
  const days = useMemo(() => generateDays(LAB_TODAY, 14), []);
  const slots = useMemo(() => (s.day && service ? generateSlots(s.day, service, { nowMinutes: s.day === LAB_TODAY ? 11 * 60 : undefined }) : []), [s.day, service]);

  // Move focus to the new step's heading so screen-reader and keyboard users land in the right place.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [s.step]);

  const holdActive = s.step === "time" && s.time !== null;
  const hold = useHoldTimer(holdActive, HOLD_SECONDS, `${s.day}-${s.time}`, () => {
    dispatch({ type: "selectDay", iso: s.day! }); // clears the time, keeps the day
    toast(t("time.holdExpired"), { variant: "warning" });
  });

  const stepIndex = VISIBLE_STEPS.indexOf(s.step as (typeof VISIBLE_STEPS)[number]);
  const firstAvailable = days.find((d) => !d.closed && generateSlots(d.iso, service ?? LAB_SERVICES[0], { nowMinutes: d.iso === LAB_TODAY ? 11 * 60 : undefined }).length > 0);

  const detailsErrors = {
    fullName: touched && s.details.fullName.trim().length < 2 ? t("details.errors.fullName") : undefined,
    phone: touched && normalizePhone(s.details.phone) === null ? t("details.errors.phone") : undefined,
    email: touched && s.details.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.details.email.trim()) ? t("details.errors.email") : undefined,
  };

  function onContinue() {
    if (s.step === "details") {
      setTouched(true);
      if (!detailsValid(s.details)) return;
    }
    dispatch({ type: "next" });
  }

  if (s.step === "done" && service && s.day && s.time) {
    return <Confirmation service={service} day={s.day} time={s.time} onAnother={() => dispatch({ type: "reset" })} />;
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col pb-32">
      <header className="flex items-center gap-3 px-4 pt-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-foreground text-lg font-bold text-background" aria-hidden>
          ה
        </div>
        <div className="min-w-0">
          <p className="truncate text-base leading-tight font-semibold">{t("businessName")}</p>
          <p className="truncate text-sm text-muted-foreground">{t("businessAddress")}</p>
        </div>
      </header>

      <nav aria-label={t("stepper")} className="px-4 pt-5">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          {t("stepOf", { current: stepIndex + 1, total: VISIBLE_STEPS.length })}
        </p>
        <ol className="flex gap-1.5">
          {VISIBLE_STEPS.map((st, i) => (
            <li key={st} className="flex-1" aria-current={i === stepIndex ? "step" : undefined}>
              <div className={cn("h-1.5 rounded-full transition-colors duration-200", i <= stepIndex ? "bg-primary" : "bg-border")} />
              <span className="sr-only">{t(`steps.${st}`)}</span>
            </li>
          ))}
        </ol>
      </nav>

      <main id="main" className="flex-1 px-4 pt-6">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">
          {t(`${s.step as "service"}.title`)}
        </h1>

        {s.step === "service" && (
          <fieldset className="mt-4">
            <legend className="mb-3 text-sm text-muted-foreground">{t("service.subtitle")}</legend>
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {LAB_SERVICES.map((x) => (
                <ChoiceCard key={x.id} variant="row" name="service" value={x.id} checked={s.serviceId === x.id} onChange={(v) => dispatch({ type: "selectService", serviceId: v })} testId={`service-${x.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{x.name}</p>
                    <p className="text-sm text-muted-foreground">{x.description}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="font-semibold">{formatPrice(x.priceNis)}</p>
                    <p className="text-sm text-muted-foreground">{t("service.duration", { minutes: x.durationMinutes })}</p>
                  </div>
                </ChoiceCard>
              ))}
            </div>
          </fieldset>
        )}

        {s.step === "day" && (
          <div className="mt-4 grid gap-5">
            <p className="text-sm text-muted-foreground">{t("day.subtitle")}</p>
            <WeekPicker days={days} value={s.day} onChange={(iso) => dispatch({ type: "selectDay", iso })} today={LAB_TODAY} hasFree={(iso) => generateSlots(iso, service ?? LAB_SERVICES[0], { nowMinutes: iso === LAB_TODAY ? 11 * 60 : undefined }).length > 0} />
            {firstAvailable ? (
              <Button type="button" variant="outline" className="justify-between" onClick={() => dispatch({ type: "selectDay", iso: firstAvailable.iso })}>
                {t("day.firstAvailable")}
                <span className="text-muted-foreground">{formatDayLabel(firstAvailable.iso, "short")}</span>
              </Button>
            ) : null}
          </div>
        )}

        {s.step === "time" && s.day && service && (
          <div className="mt-4 grid gap-6">
            <p className="text-sm text-muted-foreground">{t("time.subtitle", { day: formatDayLabel(s.day), service: service.name })}</p>
            {(() => {
              const b = dayBounds(s.day);
              return b ? (
                <TimeRibbon
                  from={b.from}
                  to={b.to}
                  segments={slotSegments(s.day, service, s.time)}
                  tickEvery={(b.to - b.from) / 60 > 6 ? 3 : 1}
                  label={t("time.ribbonLabel", { day: formatDayLabel(s.day, "short") })}
                  legend
                />
              ) : null;
            })()}
            {slots.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">{t("time.none")}</p>
                <Button type="button" variant="outline" className="mt-3" onClick={() => dispatch({ type: "back" })}>
                  {t("time.noneAction")}
                </Button>
              </div>
            ) : (
              (["morning", "afternoon", "evening"] as const).map((part) => {
                const group = slots.filter((x) => dayPart(x.time) === part);
                if (group.length === 0) return null;
                return (
                  <fieldset key={part}>
                    <legend className="mb-2 text-sm font-semibold text-muted-foreground">{t(`time.${part}`)}</legend>
                    <div className="grid grid-cols-4 gap-2">
                      {group.map((x) => (
                        <ChoiceCard key={x.time} variant="chip" name="time" value={x.time} checked={s.time === x.time} onChange={(v) => dispatch({ type: "selectTime", time: v })} className="text-base font-semibold" testId={`time-${x.time}`}>
                          <bdi>{x.time}</bdi>
                        </ChoiceCard>
                      ))}
                    </div>
                  </fieldset>
                );
              })
            )}
            {holdActive ? (
              <p role="status" className="flex items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-sm font-medium text-info-soft-foreground" data-testid="hold">
                <Timer className="size-4" aria-hidden />
                {t("time.held", { time: hold.label })}
              </p>
            ) : null}
          </div>
        )}

        {s.step === "details" && service && s.day && s.time && (
          <form
            noValidate
            className="mt-4 grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              onContinue();
            }}
          >
            <p className="text-sm text-muted-foreground">{t("details.subtitle")}</p>
            <FormField label={t("details.fullName")} error={detailsErrors.fullName}>
              {(a) => <Input {...a} autoComplete="name" value={s.details.fullName} onChange={(e) => dispatch({ type: "setDetails", details: { ...s.details, fullName: e.target.value } })} />}
            </FormField>
            <FormField label={t("details.phone")} hint={t("details.phoneHint")} error={detailsErrors.phone}>
              {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" value={s.details.phone} onChange={(e) => dispatch({ type: "setDetails", details: { ...s.details, phone: e.target.value } })} />}
            </FormField>
            <FormField label={t("details.email")} hint={t("details.emailHint")} error={detailsErrors.email}>
              {(a) => <Input {...a} type="email" inputMode="email" autoComplete="email" value={s.details.email} onChange={(e) => dispatch({ type: "setDetails", details: { ...s.details, email: e.target.value } })} />}
            </FormField>
            <p className="text-xs text-muted-foreground">
              {t.rich("details.consent", {
                terms: (c) => <Link href="/terms" className="underline underline-offset-2">{c}</Link>,
                privacy: (c) => <Link href="/privacy" className="underline underline-offset-2">{c}</Link>,
              })}
            </p>
          </form>
        )}
      </main>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          {s.step !== "service" ? (
            <Button type="button" variant="outline" size="lg" onClick={() => dispatch({ type: "back" })} aria-label={t("actions.back")}>
              <ArrowRight aria-hidden />
              <span className="hidden sm:inline">{t("actions.back")}</span>
            </Button>
          ) : null}
          <div className="min-w-0 flex-1 text-sm" aria-live="polite">
            {service ? (
              <>
                <p className="truncate font-semibold">{service.name}</p>
                <p className="truncate text-muted-foreground">
                  {s.day ? formatDayLabel(s.day, "short") : null}
                  {s.time ? <> · <bdi>{s.time}</bdi></> : null}
                  {!s.day ? formatPrice(service.priceNis) : null}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{t("summary.none")}</p>
            )}
          </div>
          <Button type="button" size="lg" disabled={s.step !== "details" && !canContinue(s)} onClick={onContinue} data-testid="continue">
            {s.step === "details" ? t("actions.confirm") : t("actions.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Confirmation({ service, day, time, onAnother }: { service: (typeof LAB_SERVICES)[number]; day: string; time: string; onAnother: () => void }) {
  const t = useTranslations("booking");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const ref = `TR-${(Array.from(day + time).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 90000 + 10000).toString(36).toUpperCase()}`;
  return (
    <main id="main" className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-center px-4 py-10 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300" aria-hidden>
        <Check className="size-10" strokeWidth={3} />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-5 text-3xl font-bold tracking-tight outline-none" data-testid="done-title">
        {t("done.title")}
      </h1>
      <p className="mt-1 text-muted-foreground">{t("done.subtitle")}</p>

      <dl className="mt-6 w-full divide-y rounded-xl border bg-card text-start ">
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">{t("summary.service")}</dt>
          <dd className="font-semibold">{service.name}</dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">{t("summary.when")}</dt>
          <dd className="font-semibold" data-testid="done-when">
            {formatDayLabel(day)} · <bdi>{time}</bdi>
          </dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">{t("summary.price")}</dt>
          <dd className="font-semibold">{formatPrice(service.priceNis)}</dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">{t("done.reference")}</dt>
          <dd className="font-mono font-semibold"><bdi>{ref}</bdi></dd>
        </div>
      </dl>

      <p className="mt-4 text-sm text-muted-foreground">{t("done.policy")}</p>
      <div className="mt-6 grid w-full gap-3">
        <Button type="button" size="lg" onClick={() => toast(t("done.calendarToast"), { variant: "info" })}>
          <CalendarPlus aria-hidden />
          {t("actions.addToCalendar")}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onAnother}>
          {t("actions.bookAnother")}
        </Button>
      </div>
    </main>
  );
}
