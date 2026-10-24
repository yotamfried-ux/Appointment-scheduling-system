"use client";

import { AlertTriangle, ArrowRight, CalendarPlus, Check, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { z } from "zod";
import { openWindows } from "@/lib/ribbon";
import { useHoldTimer } from "@/components/lab/booking/use-hold-timer";
import { WeekPicker } from "@/components/lab/booking/week-picker";
import { ChoiceCard } from "@/components/patterns/choice-card";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { TermsAcceptanceBox, useTermsAcceptance } from "@/components/legal/terms-acceptance";
import { ApiClientError, labApi, resolveSession, type ClientOptions } from "@/lib/api/client";
import type * as C from "@/lib/api/contracts";
import { priceLabel } from "@/lib/price";
import { formatDayLabel, LAB_TODAY, todayInBusinessZone, type LabDay } from "@/lib/lab/booking-data";
import { bookingReducer, canContinue, detailsValid, initialBookingState, STEP_ORDER, type BookingStep } from "@/lib/lab/booking-flow";
import { normalizePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { BusinessKindId } from "@/modules/tenancy/business-kind";

type Catalog = z.infer<typeof C.ServicesResponse>;
type Slots = z.infer<typeof C.SlotsResponse>;
type Booking = z.infer<typeof C.BookingDto>;
type Load<T> = { status: "idle" | "loading" } | { status: "error" } | { status: "ready"; data: T };

const HOLD_SECONDS = 5 * 60;
const HORIZON = 28;
const VISIBLE_STEPS = STEP_ORDER.slice(0, 4) as Exclude<BookingStep, "done">[];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Server field path → form field key. */
function fieldKey(path: string): string {
  if (path.startsWith("acceptedTerms")) return "acceptedTerms";
  if (path.startsWith("customer.")) return path.slice("customer.".length);
  return path;
}

/** `base` switches the data source: omitted = the lab API (design lab); `/api/public/<slug>` = a real published business. */
/** `initialCatalog` (real businesses): the server already knows the services, so the first step is in the HTML and no request has to finish before the page is usable. */
export function BookingFlow({ kind, session: sessionParam, limit, base, initialCatalog }: { kind: BusinessKindId; session?: string; limit?: number; base?: string; initialCatalog?: Catalog }) {
  const t = useTranslations("booking");
  const [s, dispatch] = useReducer(bookingReducer, initialBookingState);
  const [touched, setTouched] = useState(false);
  const terms = useTermsAcceptance();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const [session] = useState(() => (base ? "public" : resolveSession(sessionParam)));
  const [today] = useState(() => (base ? todayInBusinessZone() : LAB_TODAY));
  const opts = useMemo<ClientOptions>(() => ({ kind, session, limit, base }), [kind, session, limit, base]);

  const [catalog, setCatalog] = useState<Load<Catalog>>(initialCatalog ? { status: "ready", data: initialCatalog } : { status: "loading" });
  const [avail, setAvail] = useState<Load<Map<string, { closed: boolean; freeSlots: number }>>>({ status: "idle" });
  const [availTick, setAvailTick] = useState(0);
  const [slots, setSlots] = useState<Load<Slots>>({ status: "idle" });
  const [submit, setSubmit] = useState<{ status: "idle" | "submitting" } | { status: "error"; message: string }>({ status: "idle" });
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [booking, setBooking] = useState<Booking | null>(null);
  const idem = useRef<{ sig: string; key: string } | null>(null);

  const loadCatalog = useCallback(() => {
    setCatalog({ status: "loading" });
    labApi.services(opts).then((data) => setCatalog({ status: "ready", data }), () => setCatalog({ status: "error" }));
  }, [opts]);
  useEffect(() => {
    if (initialCatalog) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch from the API
    loadCatalog();
  }, [loadCatalog, initialCatalog]);

  const business = catalog.status === "ready" ? catalog.data.business : null;
  const horizon = Math.min(90, business?.horizonDays ?? HORIZON);
  const vocab = business?.vocab;
  const service = catalog.status === "ready" ? (catalog.data.services.find((x) => x.id === s.serviceId) ?? null) : null;
  const people = useMemo(() => {
    const team = catalog.status === "ready" ? catalog.data.team : [];
    return service?.personIds && service.personIds.length > 0 ? team.filter((p) => service.personIds!.includes(p.id)) : team;
  }, [catalog, service]);
  const personId = s.personId && people.some((p) => p.id === s.personId) ? s.personId : null;
  const selectedPerson = personId ? people.find((p) => p.id === personId) : null;
  const requiredIntake = useMemo(() => (business?.intake ?? []).map((f) => ({ id: f.id, required: f.required })), [business]);

  // Availability for the day picker (re-fetched when the service changes; latest request wins).
  useEffect(() => {
    if (!s.serviceId) return;
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on service change
    setAvail({ status: "loading" });
    labApi
      .availability({ ...opts, signal: ctl.signal }, { service: s.serviceId, from: today, days: horizon, person: personId ?? undefined })
      .then((r) => setAvail({ status: "ready", data: new Map(r.days.map((d) => [d.date, d])) }))
      .catch((e) => (e instanceof DOMException ? undefined : setAvail({ status: "error" })));
    return () => ctl.abort();
  }, [opts, today, horizon, s.serviceId, personId, availTick, s.step === "day" ? "day" : "-"]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh whenever the day step is (re)entered

  const reloadSlots = useCallback(
    (selected?: string | null) => {
      if (!s.serviceId || !s.day) return () => undefined;
      const ctl = new AbortController();
      setSlots((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
      labApi
        .slots({ ...opts, signal: ctl.signal }, { service: s.serviceId, date: s.day, selected: selected ?? undefined, person: personId ?? undefined })
        .then((data) => setSlots({ status: "ready", data }))
        .catch((e) => (e instanceof DOMException ? undefined : setSlots({ status: "error" })));
      return () => ctl.abort();
    },
    [opts, s.serviceId, s.day, personId],
  );
  useEffect(() => {
    if (s.step !== "time") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch slots when the time step is entered or the selection changes
    return reloadSlots(s.time);
  }, [reloadSlots, s.step, s.time]);

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
    dispatch({ type: "selectDay", iso: s.day! });
    toast(t("time.holdExpired"), { variant: "warning" });
  });

  const days: LabDay[] = useMemo(
    () =>
      Array.from({ length: horizon }, (_, i) => {
        const iso = addDays(today, i);
        const a = avail.status === "ready" ? avail.data.get(iso) : undefined;
        return { iso, weekday: weekdayOf(iso), closed: a?.closed ?? weekdayOf(iso) === 6 };
      }),
    [avail, today, horizon],
  );
  const hasFree = (iso: string) => (avail.status === "ready" ? (avail.data.get(iso)?.freeSlots ?? 0) > 0 : false);
  const firstAvailable = avail.status === "ready" ? days.find((d) => hasFree(d.iso)) : undefined;

  const stepIndex = VISIBLE_STEPS.indexOf(s.step as (typeof VISIBLE_STEPS)[number]);
  const requiredMsg = t("details.required");
  const intakeValues = s.details.intake ?? {};
  const detailsErrors: Record<string, string | undefined> = {
    fullName: serverErrors.fullName ?? (touched && s.details.fullName.trim().length < 2 ? t("details.errors.fullName") : undefined),
    phone: serverErrors.phone ?? (touched && normalizePhone(s.details.phone) === null ? t("details.errors.phone") : undefined),
    email: serverErrors.email ?? (touched && !EMAIL.test(s.details.email.trim()) ? t(s.details.email.trim() === "" ? "details.errors.emailRequired" : "details.errors.email") : undefined),
  };
  detailsErrors.acceptedTerms = serverErrors.acceptedTerms ?? (touched && !terms.ok ? terms.requiredMessage : undefined);
  for (const f of business?.intake ?? []) {
    detailsErrors[`intake.${f.id}`] = serverErrors[`intake.${f.id}`] ?? (touched && f.required && !(intakeValues[f.id] ?? "").trim() ? requiredMsg : undefined);
  }

  const setDetails = (patch: Partial<typeof s.details>) => {
    setServerErrors({});
    dispatch({ type: "setDetails", details: { ...s.details, ...patch } });
  };

  async function submitBooking() {
    if (!service || !s.day || !s.time || !business) return;
    setTouched(true);
    if (!detailsValid(s.details, requiredIntake) || !terms.ok) return;
    const location = s.details.location ?? business.locations[0];
    const body = {
      serviceId: service.id,
      date: s.day,
      time: s.time,
      location,
      ...(personId ? { personId } : {}),
      customer: { fullName: s.details.fullName.trim(), phone: s.details.phone, email: s.details.email.trim() },
      intake: Object.fromEntries(Object.entries(intakeValues).filter(([, v]) => v.trim() !== "")),
      acceptedTerms: terms.payload,
    } as z.input<typeof C.CreateBookingRequest>;
    const sig = JSON.stringify(body);
    if (idem.current?.sig !== sig) idem.current = { sig, key: crypto.randomUUID() };

    setSubmit({ status: "submitting" });
    setServerErrors({});
    try {
      const b = await labApi.createBooking(opts, body, idem.current.key);
      terms.remember();
      setBooking(b);
      setSubmit({ status: "idle" });
      dispatch({ type: "next" });
    } catch (e) {
      if (!(e instanceof ApiClientError)) return setSubmit({ status: "error", message: t("errors.generic") });
      if (e.code === "SLOT_TAKEN" || e.code === "INVALID_SLOT") {
        setSubmit({ status: "idle" });
        setSlots({ status: "loading" });
        dispatch({ type: "selectDay", iso: s.day });
        dispatch({ type: "back" });
        toast(e.code === "SLOT_TAKEN" ? t("errors.slotTaken") : t("errors.invalidSlot"), { variant: "warning" });
      } else if (e.code === "SERVICE_UNAVAILABLE") {
        setSubmit({ status: "idle" });
        toast(t("errors.serviceUnavailable"), { variant: "warning" });
        setBooking(null);
        dispatch({ type: "reset" });
        loadCatalog();
      } else if (e.code === "BLOCKED") {
        setSubmit({ status: "error", message: e.message });
      } else if (e.code === "BOOKING_LIMIT") {
        setSubmit({ status: "error", message: t("errors.bookingLimit") });
      } else if (e.code === "VALIDATION_FAILED") {
        setServerErrors(Object.fromEntries(e.details.map((d) => [fieldKey(d.field), d.message])));
        setSubmit({ status: "error", message: t("errors.validation") });
      } else if (e.code === "RATE_LIMITED") {
        setSubmit({ status: "error", message: t("errors.rateLimited", { seconds: e.retryAfter ?? 30 }) });
      } else if (e.code === "NETWORK") {
        setSubmit({ status: "error", message: t("errors.network") });
      } else {
        setSubmit({ status: "error", message: t("errors.generic") });
      }
    }
  }

  function onContinue() {
    if (s.step === "details") {
      void submitBooking();
      return;
    }
    dispatch({ type: "next" });
  }

  if (catalog.status === "error") {
    return <LoadError onRetry={loadCatalog} />;
  }
  if (catalog.status !== "ready" || !business || !vocab) {
    return (
      <main id="main" className="mx-auto flex min-h-svh w-full max-w-lg items-center justify-center px-4" aria-busy="true">
        <p role="status" className="text-muted-foreground">{t("loading")}</p>
      </main>
    );
  }

  if (s.step === "done" && service && s.day && s.time && booking) {
    return (
      <Confirmation
        service={service}
        booking={booking}
        email={base ? "" : s.details.email.trim()}
        opts={opts}
        doneTitle={vocab.doneTitle}
        cancelUntilHours={business.cancelUntilHours}
        onAnother={() => {
          setBooking(null);
          setTouched(false);
          dispatch({ type: "reset" });
        }}
      />
    );
  }

  const submitting = submit.status === "submitting";

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col pb-32" data-kind={kind}>
      <header className="flex items-center gap-3 border-b px-4 py-5 sm:px-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground" aria-hidden>
          {business.name.replace(/^(ה|ס)/, "").slice(0, 1) || business.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base leading-tight font-bold" data-testid="business-name">{business.name}</p>
          {business.address ? <p className="truncate text-sm text-muted-foreground">{business.address}</p> : null}
        </div>
      </header>

      <nav aria-label={t("stepper")} className="px-4 pt-5 sm:px-6">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{t("stepOf", { current: stepIndex + 1, total: VISIBLE_STEPS.length })}</span>
          <span>{t(`steps.${s.step as "service"}`)}</span>
        </div>
        <ol className="flex gap-1.5">
          {VISIBLE_STEPS.map((st, i) => (
            <li key={st} className="flex-1" aria-current={i === stepIndex ? "step" : undefined}>
              <div className={cn("h-1.5 rounded-full transition-colors duration-200", i <= stepIndex ? "bg-primary" : "bg-border")} />
              <span className="sr-only">{t(`steps.${st}`)}</span>
            </li>
          ))}
        </ol>
      </nav>

      {/* Two-Column Concierge Card on desktop, single column on mobile */}
      <div className="grid flex-1 items-start gap-6 px-4 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.9fr)]">
        <main id="main" className="min-w-0">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">
            {s.step === "service" ? vocab.pickService : t(`${s.step as "day"}.title`)}
          </h1>

          {s.step === "service" && (
            <fieldset className="mt-4">
              <legend className="mb-3 text-sm text-muted-foreground">{vocab.pickServiceHint}</legend>
              <div className="divide-y overflow-hidden rounded-xl border bg-card">
                {catalog.data.services.map((x) => (
                  <ChoiceCard key={x.id} variant="row" name="service" value={x.id} checked={s.serviceId === x.id} onChange={(v) => dispatch({ type: "selectService", serviceId: v })} testId={`service-${x.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{x.name}</p>
                      <p className="text-sm text-muted-foreground">{x.description}</p>
                    </div>
                    <div className="shrink-0 text-end">
                      {priceLabel(x.priceMode, x.priceNis) ? <p className="font-semibold">{priceLabel(x.priceMode, x.priceNis)}</p> : null}
                      <p className="text-sm text-muted-foreground">{t("service.duration", { minutes: x.durationMinutes })}</p>
                    </div>
                  </ChoiceCard>
                ))}
              </div>
              {service && people.length >= 2 ? (
                <fieldset className="mt-6" data-testid="person-choice">
                  <legend className="mb-3 text-sm text-muted-foreground">{t("person.legend")}</legend>
                  <div className="divide-y overflow-hidden rounded-xl border bg-card">
                    <ChoiceCard variant="row" name="person" value="" checked={personId === null} onChange={() => dispatch({ type: "selectPerson", personId: null })} testId="person-any">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{t("person.any")}</p>
                        <p className="text-sm text-muted-foreground">{t("person.anyHint")}</p>
                      </div>
                    </ChoiceCard>
                    {people.map((p) => (
                      <ChoiceCard key={p.id} variant="row" name="person" value={p.id} checked={personId === p.id} onChange={(v) => dispatch({ type: "selectPerson", personId: v })} testId={`person-${p.id}`}>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{p.name}</p>
                        </div>
                      </ChoiceCard>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </fieldset>
          )}

          {s.step === "day" && (
            <div className="mt-4 grid gap-5">
              <p className="text-sm text-muted-foreground">{t("day.subtitle")}</p>
              {avail.status === "error" ? (
                <InlineError message={t("day.loadError")} retry={t("loadError.retry")} onRetry={() => setAvailTick((n) => n + 1)} />
              ) : (
                <div aria-busy={avail.status !== "ready"} className={cn(avail.status !== "ready" && "pointer-events-none opacity-60")}>
                  <WeekPicker days={days} value={s.day} onChange={(iso) => dispatch({ type: "selectDay", iso })} today={today} hasFree={hasFree} />
                </div>
              )}
              {firstAvailable ? (
                <Button type="button" variant="outline" className="justify-between" onClick={() => dispatch({ type: "selectDay", iso: firstAvailable.iso })}>
                  {t("day.firstAvailable")}
                  <span className="text-muted-foreground">{formatDayLabel(firstAvailable.iso, "short")}</span>
                </Button>
              ) : null}
              {base && business?.waitlistEnabled && s.serviceId ? (
                <p className="text-sm text-muted-foreground" data-testid="waitlist-hint">
                  {t("day.waitlistHint")}{" "}
                  <a href={`/book/${base.split("/").pop()}/waitlist?service=${encodeURIComponent(s.serviceId)}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-2" data-testid="waitlist-link">
                    {t("day.waitlistLink")}
                  </a>
                </p>
              ) : null}
            </div>
          )}

          {s.step === "time" && s.day && service && (
            <div className="mt-4 grid gap-5">
              <p className="text-sm text-muted-foreground">{t("time.subtitle", { day: formatDayLabel(s.day), service: service.name })}</p>
              {slots.status === "error" ? (
                <InlineError message={t("time.loadError")} retry={t("loadError.retry")} onRetry={() => reloadSlots(s.time)} />
              ) : slots.status !== "ready" ? (
                <p role="status" className="text-sm text-muted-foreground" data-testid="slots-loading">{t("time.loading")}</p>
              ) : (
                <>
                  {openWindows(slots.data.segments).length ? (
                    <p className="text-sm font-medium text-muted-foreground" data-testid="time-summary">
                      {t("time.openWindows", { windows: openWindows(slots.data.segments).join(" · ") })}
                    </p>
                  ) : null}
                  {slots.data.slots.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-6 text-center">
                      <p className="text-sm text-muted-foreground">{t("time.none")}</p>
                      <Button type="button" variant="outline" className="mt-3" onClick={() => dispatch({ type: "back" })}>
                        {t("time.noneAction")}
                      </Button>
                    </div>
                  ) : (
                    /* Single continuous chronological grid without morning/afternoon/evening sub-headers */
                    <fieldset>
                      <legend className="sr-only">{t("time.title")}</legend>
                      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                        {slots.data.slots.map((x) => (
                          <ChoiceCard
                            key={x.time}
                            variant="chip"
                            name="time"
                            value={x.time}
                            checked={s.time === x.time}
                            onChange={(v) => dispatch({ type: "selectTime", time: v })}
                            className="min-h-11 justify-center rounded-xl text-base font-semibold tabular-nums"
                            testId={`time-${x.time}`}
                          >
                            <bdi>{x.time}</bdi>
                            {x.spotsLeft !== undefined ? (
                              <span className="sr-only" data-testid={`left-${x.time}`}>
                                {t("time.left", { count: x.spotsLeft })}
                              </span>
                            ) : null}
                          </ChoiceCard>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </>
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
              method="post"
              noValidate
              className="mt-4 grid gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!submitting) onContinue();
              }}
            >
              <p className="text-sm text-muted-foreground">{t("details.subtitle")}</p>
              <FormField label={t("details.fullName")} error={detailsErrors.fullName}>
                {(a) => <Input {...a} autoComplete="name" value={s.details.fullName} onChange={(e) => setDetails({ fullName: e.target.value })} />}
              </FormField>
              <FormField label={t("details.phone")} hint={t("details.phoneHint")} error={detailsErrors.phone}>
                {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" value={s.details.phone} onChange={(e) => setDetails({ phone: e.target.value })} />}
              </FormField>
              <FormField label={t("details.email")} hint={t("details.emailHint")} error={detailsErrors.email}>
                {(a) => <Input {...a} type="email" inputMode="email" autoComplete="email" value={s.details.email} onChange={(e) => setDetails({ email: e.target.value })} />}
              </FormField>

              {business.locations.length > 1 ? (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">{t("details.location")}</legend>
                  <div className="grid grid-cols-1 gap-2">
                    {business.locations.map((l) => (
                      <ChoiceCard key={l} variant="card" name="location" value={l} checked={(s.details.location ?? business.locations[0]) === l} onChange={(v) => setDetails({ location: v })} testId={`location-${l}`}>
                        <span className="font-medium">{t(`details.locations.${l}`)}</span>
                      </ChoiceCard>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {business.intake.map((f) => (
                <FormField key={f.id} label={f.label} error={detailsErrors[`intake.${f.id}`]}>
                  {(a) =>
                    f.type === "select" ? (
                      <NativeSelect {...a} value={intakeValues[f.id] ?? ""} onChange={(e) => setDetails({ intake: { ...intakeValues, [f.id]: e.target.value } })} data-testid={`intake-${f.id}`}>
                        <option value="">{t("details.choose")}</option>
                        {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                      </NativeSelect>
                    ) : (
                      <Input {...a} value={intakeValues[f.id] ?? ""} maxLength={200} onChange={(e) => setDetails({ intake: { ...intakeValues, [f.id]: e.target.value } })} data-testid={`intake-${f.id}`} />
                    )
                  }
                </FormField>
              ))}

              {submit.status === "error" ? (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive" data-testid="submit-error">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {submit.message}
                </div>
              ) : null}
              {terms.needed ? <TermsAcceptanceBox checked={terms.checked} onChange={(v) => { setServerErrors({}); terms.setChecked(v); }} error={detailsErrors.acceptedTerms} /> : null}
            </form>
          )}
        </main>

        {/* Live Summary Ticket (Direction B Concierge Card) */}
        <aside aria-label={t("summary.title")} className="hidden rounded-xl border bg-card p-5 lg:sticky lg:top-6 lg:block">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">{t("summary.title")}</p>
          <p className="mt-1 text-base font-bold">{business.name}</p>
          {business.address ? <p className="text-xs text-muted-foreground">{business.address}</p> : null}

          <dl className="mt-4 divide-y border-t text-sm">
            <div className="flex items-baseline justify-between gap-3 py-3">
              <dt className="text-muted-foreground">{t("summary.service")}</dt>
              <dd className="text-end font-semibold">{service ? service.name : t("summary.none")}</dd>
            </div>
            {people.length >= 2 ? (
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="text-muted-foreground">{t("summary.person")}</dt>
                <dd className="text-end font-semibold">{selectedPerson ? selectedPerson.name : t("person.any")}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3 py-3">
              <dt className="text-muted-foreground">{t("summary.when")}</dt>
              <dd className="text-end font-semibold">
                {s.day ? (
                  <>
                    {formatDayLabel(s.day, "short")}
                    {s.time ? <> · <bdi>{s.time}</bdi></> : null}
                  </>
                ) : (
                  t("summary.none")
                )}
              </dd>
            </div>
            {service && priceLabel(service.priceMode, service.priceNis) ? (
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="text-muted-foreground">{t("summary.price")}</dt>
                <dd className="text-end font-bold">{priceLabel(service.priceMode, service.priceNis)}</dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
          {s.step !== "service" ? (
            <Button type="button" variant="outline" size="lg" disabled={submitting} onClick={() => dispatch({ type: "back" })} aria-label={t("actions.back")}>
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
                  {!s.day ? priceLabel(service.priceMode, service.priceNis) : null}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{t("summary.none")}</p>
            )}
          </div>
          <Button type="button" size="lg" disabled={submitting || (s.step !== "details" && !canContinue(s))} onClick={onContinue} data-testid="continue">
            {submitting ? t("details.submitting") : s.step === "details" ? vocab.bookCta : t("actions.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InlineError({ message, retry, onRetry }: { message: string; retry: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-dashed p-6 text-center" data-testid="inline-error">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>{retry}</Button>
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("booking.loadError");
  return (
    <main id="main" className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-center justify-center px-4 text-center" data-testid="load-error">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("body")}</p>
      <Button type="button" size="lg" className="mt-5" onClick={onRetry}>{t("retry")}</Button>
    </main>
  );
}

function ManageLink({ path }: { path: string }) {
  const t = useTranslations("booking.done");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []); // eslint-disable-line react-hooks/set-state-in-effect -- origin is only known in the browser
  return (
    <div className="mt-4 w-full rounded-lg border bg-card p-4 text-start" data-testid="manage-box">
      <p className="text-sm text-muted-foreground">{t("manageHint")}</p>
      <a href={path} className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-2" data-testid="manage-link" data-origin={origin}>
        {t("manage")}
      </a>
    </div>
  );
}

function Confirmation({ service, booking, email, opts, doneTitle, cancelUntilHours, onAnother }: { service: { name: string; priceNis: number; priceMode?: "fixed" | "from" | "free" | "hidden" }; booking: Booking; email: string; opts: ClientOptions; doneTitle: string; cancelUntilHours: number; onAnother: () => void }) {
  const t = useTranslations("booking");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [mail, setMail] = useState<{ subject: string; body: string; to: string } | null>(null);
  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    if (!email) return;
    labApi.notification(opts, booking.id).then(setMail, () => undefined);
  }, [email, opts, booking.id]);
  const pending = booking.status === "pending";
  const real = Boolean(booking.manageUrl);
  return (
    <main id="main" className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-center px-4 py-10 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300" aria-hidden>
        <Check className="size-10" strokeWidth={3} />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-5 text-3xl font-bold tracking-tight outline-none" data-testid="done-title">
        {pending ? t("done.pendingTitle") : doneTitle}
      </h1>
      <p className="mt-1 text-muted-foreground">{pending ? t(real ? "done.pendingSubtitleReal" : "done.pendingSubtitle") : t(real ? "done.subtitleReal" : "done.subtitle")}</p>

      <dl className="mt-6 w-full divide-y rounded-xl border bg-card text-start">
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">{t("summary.service")}</dt>
          <dd className="font-semibold">{service.name}</dd>
        </div>
        {booking.personName ? (
          <div className="flex justify-between gap-4 p-4">
            <dt className="text-muted-foreground">{t("summary.person")}</dt>
            <dd className="font-semibold" data-testid="done-person">{booking.personName}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">{t("summary.when")}</dt>
          <dd className="font-semibold" data-testid="done-when">
            {formatDayLabel(booking.date)} · <bdi>{booking.time}</bdi>
          </dd>
        </div>
        {priceLabel(service.priceMode, service.priceNis) ? (
          <div className="flex justify-between gap-4 p-4">
            <dt className="text-muted-foreground">{t("summary.price")}</dt>
            <dd className="font-semibold">{priceLabel(service.priceMode, service.priceNis)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">{t("done.status")}</dt>
          <dd className="font-semibold" data-testid="done-status">{pending ? t("done.statusPending") : t("done.statusConfirmed")}</dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">{t("done.reference")}</dt>
          <dd className="font-mono font-semibold" data-testid="done-reference"><bdi>{booking.reference}</bdi></dd>
        </div>
      </dl>

      {booking.manageUrl ? <ManageLink path={booking.manageUrl} /> : null}

      {mail ? (
        <details className="mt-4 w-full rounded-lg border bg-card p-4 text-start" data-testid="email-preview">
          <summary className="cursor-pointer text-sm font-semibold">{t("done.emailPreview")}</summary>
          <p className="mt-3 text-sm font-semibold">{mail.subject}</p>
          <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground" data-testid="email-body">{mail.body}</p>
        </details>
      ) : null}

      <p className="mt-4 text-sm text-muted-foreground">{real ? t("done.policyReal", { hours: cancelUntilHours }) : t("done.policy")}</p>
      <div className="mt-6 grid w-full gap-3">
        {real ? null : (
          <Button type="button" size="lg" onClick={() => toast(t("done.calendarToast"), { variant: "info" })}>
            <CalendarPlus aria-hidden />
            {t("actions.addToCalendar")}
          </Button>
        )}
        <Button type="button" variant={real ? "default" : "outline"} size="lg" onClick={onAnother}>
          {t("actions.bookAnother")}
        </Button>
      </div>
    </main>
  );
}
