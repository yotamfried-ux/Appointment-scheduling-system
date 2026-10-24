"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ApiClientError, ownerApi } from "@/lib/api/client";
import { fmt } from "@/lib/lab/dashboard-data";

export interface ManualService {
  id: string;
  name: string;
  durationMinutes: number;
  personIds?: string[] | null;
}

const FIELD: Record<string, "service" | "date" | "time" | "name" | "phone" | "note"> = {
  serviceId: "service",
  date: "date",
  time: "time",
  "customer.fullName": "name",
  "customer.phone": "phone",
  note: "note",
};

/** A phone call or a walk-in: the owner books it directly. Confirmed at once; the server decides conflicts and opening hours. */
export function ManualDialog({
  open,
  onOpenChange,
  services,
  people = [],
  defaultPerson = "",
  date,
  time,
  windows = [],
  onCreated,
}: {
  people?: { id: string; name: string }[];
  defaultPerson?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  services: ManualService[];
  date: string;
  time: string;
  windows?: { from: number; to: number }[];
  onCreated: (date: string) => void;
}) {
  const t = useTranslations("owner.manual");
  const [form, setForm] = useState({ service: "", person: defaultPerson, date, time, name: "", phone: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedService = useMemo(() => services.find((s) => s.id === form.service) ?? null, [services, form.service]);
  const eligiblePeople = useMemo(() => {
    if (!selectedService?.personIds || selectedService.personIds.length === 0) return people;
    return people.filter((p) => selectedService.personIds!.includes(p.id));
  }, [people, selectedService]);
  const effectivePerson = form.person && eligiblePeople.some((p) => p.id === form.person) ? form.person : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    if (!form.service) next.service = t("required");
    if (!form.date) next.date = t("required");
    if (!form.time) next.time = t("required");
    if (!form.name.trim()) next.name = t("required");
    if (!form.phone.trim()) next.phone = t("required");
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const r = await ownerApi.createManual({
        serviceId: form.service,
        date: form.date,
        time: form.time,
        customer: { fullName: form.name, phone: form.phone },
        ...(form.note.trim() ? { note: form.note } : {}),
        ...(effectivePerson ? { personId: effectivePerson } : {}),
      });
      toast(r.outOfHours ? t("addedOutside") : t("added"), { variant: r.outOfHours ? "warning" : "success" });
      onCreated(form.date);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "VALIDATION_FAILED" && err.details.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [FIELD[d.field] ?? "form", d.message])));
      } else if (err instanceof ApiClientError && err.code === "SLOT_TAKEN") setFormError(t("errSlotTaken"));
      else if (err instanceof ApiClientError && err.code === "INVALID_SLOT") setFormError(t("errPast"));
      else setFormError(t("errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={submit} noValidate className="grid gap-4" data-testid="manual-form">
          <FormField label={t("service")} error={errors.service}>
            {(a) => (
              <NativeSelect {...a} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} data-testid="manual-service">
                <option value="">{t("choose")}</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            )}
          </FormField>
          {eligiblePeople.length > 1 ? (
            <FormField label={t("person")}>
              {(a) => (
                <NativeSelect {...a} value={effectivePerson} onChange={(e) => setForm({ ...form, person: e.target.value })} data-testid="manual-person">
                  <option value="">{t("anyPerson")}</option>
                  {eligiblePeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
              )}
            </FormField>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
            <FormField label={t("date")} error={errors.date}>
              {(a) => <Input {...a} type="date" dir="ltr" className="text-start" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="manual-date" />}
            </FormField>
            <FormField label={t("time")} error={errors.time}>
              {(a) => <Input {...a} type="time" step={300} dir="ltr" className="text-start" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} data-testid="manual-time" />}
            </FormField>
          </div>
          {windows.length > 0 && form.date === date ? (
            <p className="text-xs text-muted-foreground">
              שעות הפעילות ביום זה: <bdi className="font-semibold tabular-nums">{windows.map((w) => `${fmt(w.from)}–${fmt(w.to)}`).join(" · ")}</bdi>
            </p>
          ) : null}
          <FormField label={t("name")} error={errors.name}>
            {(a) => <Input {...a} autoComplete="off" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="manual-name" />}
          </FormField>
          <FormField label={t("phone")} error={errors.phone}>
            {(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="off" dir="ltr" className="text-start" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="manual-phone" />}
          </FormField>
          <FormField label={t("note")} hint={t("noteHint")} error={errors.note}>
            {(a) => <Textarea {...a} rows={2} maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="manual-note" />}
          </FormField>
          {formError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive" data-testid="manual-error">{formError}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy} data-testid="manual-submit">{busy ? t("submitting") : t("submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
