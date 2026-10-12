"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { saveBookingRulesAction } from "@/app/settings/actions";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { BookingRules } from "@/modules/tenancy/booking-rules";

export function BookingRulesForm({ initial }: { initial: BookingRules }) {
  const t = useTranslations("settings.booking");
  const [f, setF] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saved" | "error" | "forbidden">("idle");
  const [pending, start] = useTransition();
  const num = (v: string) => (v === "" ? NaN : Number(v));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("idle");
    start(async () => {
      const r = await saveBookingRulesAction(f);
      setStatus(r.ok ? "saved" : r.code === "FORBIDDEN" ? "forbidden" : "error");
    });
  };

  return (
    <form onSubmit={submit} noValidate className="grid max-w-xl gap-6" data-testid="booking-rules-form">
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-lg font-semibold">{t("bookings")}</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="size-5" checked={f.requiresApproval} onChange={(e) => setF({ ...f, requiresApproval: e.target.checked })} data-testid="rules-approval" />
          <span>{t("approval")}</span>
        </label>
        <FormField label={t("cancelUntil")} hint={t("cancelUntilHint")}>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={0} max={720} value={Number.isNaN(f.cancelUntilHours) ? "" : f.cancelUntilHours} onChange={(e) => setF({ ...f, cancelUntilHours: num(e.target.value) })} data-testid="rules-cancel-hours" />}
        </FormField>
        <FormField label={t("minNotice")} hint={t("minNoticeHint")}>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={0} max={10080} value={Number.isNaN(f.minNoticeMinutes) ? "" : f.minNoticeMinutes} onChange={(e) => setF({ ...f, minNoticeMinutes: num(e.target.value) })} data-testid="rules-min-notice" />}
        </FormField>
        <FormField label={t("horizon")}>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={365} value={Number.isNaN(f.horizonDays) ? "" : f.horizonDays} onChange={(e) => setF({ ...f, horizonDays: num(e.target.value) })} data-testid="rules-horizon" />}
        </FormField>
        <FormField label={t("address")}>
          {(a) => <Input {...a} value={f.address} maxLength={200} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="rules-address" />}
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-lg font-semibold">{t("noShow")}</legend>
        <p className="text-sm text-muted-foreground">{t("noShowHint")}</p>
        <FormField label={t("policy")}>
          {(a) => (
            <NativeSelect {...a} value={f.noShowPolicy} onChange={(e) => setF({ ...f, noShowPolicy: e.target.value as BookingRules["noShowPolicy"] })} data-testid="rules-policy">
              <option value="off">{t("policies.off")}</option>
              <option value="warn">{t("policies.warn")}</option>
              <option value="require_approval">{t("policies.require_approval")}</option>
              <option value="block">{t("policies.block")}</option>
            </NativeSelect>
          )}
        </FormField>
        {f.noShowPolicy !== "off" ? (
          <FormField label={t("threshold")} hint={t("thresholdHint")}>
            {(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={20} value={Number.isNaN(f.noShowThreshold) ? "" : f.noShowThreshold} onChange={(e) => setF({ ...f, noShowThreshold: num(e.target.value) })} data-testid="rules-threshold" />}
          </FormField>
        ) : null}
        {f.noShowPolicy === "block" ? (
          <FormField label={t("blockMessage")} hint={t("blockMessageHint")}>
            {(a) => <Input {...a} value={f.blockMessage} maxLength={300} onChange={(e) => setF({ ...f, blockMessage: e.target.value })} data-testid="rules-block-message" />}
          </FormField>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-lg font-semibold">{t("daily")}</legend>
        <FormField label={t("alertMinutes")} hint={t("alertMinutesHint")}>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={0} max={1440} value={Number.isNaN(f.attendanceAlertMinutes) ? "" : f.attendanceAlertMinutes} onChange={(e) => setF({ ...f, attendanceAlertMinutes: num(e.target.value) })} data-testid="rules-alert-minutes" />}
        </FormField>
        <FormField label={t("autoComplete")} hint={t("autoCompleteHint")}>
          {(a) => <Input {...a} type="number" inputMode="numeric" min={1} max={168} placeholder={t("never")} value={f.autoCompleteHours === null || Number.isNaN(f.autoCompleteHours) ? "" : f.autoCompleteHours} onChange={(e) => setF({ ...f, autoCompleteHours: e.target.value === "" ? null : num(e.target.value) })} data-testid="rules-auto-complete" />}
        </FormField>
        <FormField label={t("digest")} hint={t("digestHint")}>
          {(a) => (
            <NativeSelect {...a} value={f.digestFrequency} onChange={(e) => setF({ ...f, digestFrequency: e.target.value as BookingRules["digestFrequency"] })} data-testid="rules-digest">
              <option value="off">{t("digestOff")}</option>
              <option value="daily">{t("digestDaily")}</option>
            </NativeSelect>
          )}
        </FormField>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending} data-testid="rules-save">{pending ? t("saving") : t("save")}</Button>
        <p role="status" aria-live="polite" className="text-sm font-medium" data-testid="rules-status">
          {status === "saved" ? t("saved") : status === "error" ? t("error") : status === "forbidden" ? t("forbidden") : ""}
        </p>
      </div>
    </form>
  );
}
