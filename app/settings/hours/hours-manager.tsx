"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { addExceptionAction, removeExceptionAction, saveHoursAction } from "@/app/settings/actions";
import { FormField } from "@/components/patterns/form-field";
import { HoursEditor } from "@/components/patterns/hours-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { addWindow, hoursValid, removeWindow, setWindow, toggleDay, type DayHours } from "@/lib/lab/onboarding";
import type { ExceptionRow } from "@/modules/availability/schema";

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const TIMES = Array.from({ length: 49 }, (_, i) => fmt(i * 30)).filter((x) => x !== "24:00");

export function HoursManager({ initial, exceptions }: { initial: DayHours[]; exceptions: ExceptionRow[] }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [hours, setHours] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const valid = hoursValid(hours);
  const dirty = JSON.stringify(hours) !== JSON.stringify(initial);

  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveHoursAction(hours);
      if (!r.ok) return setError(t(`hours.errors.${r.code === "OVERLAP" ? "overlap" : r.code === "VALIDATION" ? "invalid" : r.code === "FORBIDDEN" ? "forbidden" : "generic"}`));
      toast(t("hours.saved"), { variant: "success" });
      router.refresh();
    });

  return (
    <div className="grid gap-8">
      <section aria-labelledby="weekly-title" className="grid gap-4">
        <HoursEditor
          hours={hours}
          onToggle={(d) => setHours((h) => toggleDay(h, d))}
          onSet={(d, i, from, to) => setHours((h) => setWindow(h, d, i, from, to))}
          onAdd={(d) => setHours((h) => addWindow(h, d))}
          onRemove={(d, i) => setHours((h) => removeWindow(h, d, i))}
        />
        {!valid ? <p role="alert" className="text-sm font-medium text-destructive">{t("hours.errors.invalid")}</p> : null}
        {error ? <p role="alert" className="text-sm font-medium text-destructive" data-testid="hours-error">{error}</p> : null}
        <Button className="justify-self-start" data-testid="save-hours" disabled={pending || !valid || !dirty} onClick={save}>
          {pending ? t("hours.saving") : t("hours.save")}
        </Button>
      </section>
      <ExceptionsManager exceptions={exceptions} />
    </div>
  );
}

function ExceptionsManager({ exceptions }: { exceptions: ExceptionRow[] }) {
  const t = useTranslations("settings.exceptions");
  const router = useRouter();
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<"closed" | "open">("closed");
  const [partial, setPartial] = useState(false);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("14:00");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ date?: string; range?: string; form?: string }>({});
  const [pending, start] = useTransition();
  const hasRange = kind === "open" || partial;

  const add = () => {
    const e = { date: date ? undefined : t("dateRequired"), range: hasRange && from >= to ? t("rangeInvalid") : undefined };
    setErrors(e);
    if (e.date || e.range) return;
    start(async () => {
      const r = await addExceptionAction({ date, kind, ...(hasRange ? { from, to } : {}), note });
      if (!r.ok) return setErrors({ form: t("generic") });
      toast(t("saved"), { variant: "success" });
      setDate("");
      setNote("");
      router.refresh();
    });
  };
  const remove = (id: string) =>
    start(async () => {
      const r = await removeExceptionAction(id);
      if (!r.ok) return toast(t("generic"), { variant: "warning" });
      toast(t("removed"), { variant: "info" });
      router.refresh();
    });

  return (
    <section aria-labelledby="exceptions-title" className="grid gap-4">
      <div>
        <h2 id="exceptions-title" className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {exceptions.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid="exceptions-empty">{t("empty")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" data-testid="exceptions-list">
          {exceptions.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`exception-${x.on_date}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{formatDayLabel(x.on_date)}</p>
                <p className="text-sm text-muted-foreground">
                  {x.start_minute == null || x.end_minute == null
                    ? t("closedWhole")
                    : x.kind === "closed"
                      ? t("closedRange", { from: fmt(x.start_minute), to: fmt(x.end_minute) })
                      : t("openRange", { from: fmt(x.start_minute), to: fmt(x.end_minute) })}
                  {x.note ? ` · ${x.note}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" aria-label={`${t("remove")} · ${x.on_date}`} disabled={pending} onClick={() => remove(x.id)}>
                <Trash2 aria-hidden />
                {t("remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        method="post"
        noValidate
        aria-label={t("add")}
        className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("date")} error={errors.date}>
            {(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </FormField>
          <FormField label={t("kind")}>
            {(a) => (
              <NativeSelect {...a} value={kind} onChange={(e) => setKind(e.target.value as "closed" | "open")}>
                <option value="closed">{t("closed")}</option>
                <option value="open">{t("open")}</option>
              </NativeSelect>
            )}
          </FormField>
        </div>
        {kind === "closed" ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!partial} onChange={(e) => setPartial(!e.target.checked)} />
            {t("wholeDay")}
          </label>
        ) : null}
        {hasRange ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("from")}>
              {(a) => <NativeSelect {...a} value={from} onChange={(e) => setFrom(e.target.value)}>{TIMES.map((x) => <option key={x}>{x}</option>)}</NativeSelect>}
            </FormField>
            <FormField label={t("to")} error={errors.range}>
              {(a) => <NativeSelect {...a} value={to} onChange={(e) => setTo(e.target.value)}>{TIMES.map((x) => <option key={x}>{x}</option>)}</NativeSelect>}
            </FormField>
          </div>
        ) : null}
        <FormField label={t("note")}>
          {(a) => <Input {...a} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />}
        </FormField>
        {errors.form ? <p role="alert" className="text-sm font-medium text-destructive">{errors.form}</p> : null}
        <Button type="submit" className="justify-self-start" data-testid="add-exception" disabled={pending}>{t("add")}</Button>
      </form>
    </section>
  );
}
