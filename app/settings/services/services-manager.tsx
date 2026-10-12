"use client";

import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { saveServiceAction, setServiceActiveAction } from "@/app/settings/actions";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { priceLabel } from "@/lib/price";
import { BUFFER_OPTIONS, DURATION_OPTIONS, fromCents, type ServiceRow } from "@/modules/catalog/schema";

interface Draft {
  id?: string;
  name: string;
  description: string;
  durationMinutes: number;
  bufferMinutes: number;
  priceNis: string;
  priceMode: "fixed" | "from" | "free" | "hidden";
}
const blank: Draft = { name: "", description: "", durationMinutes: 30, bufferMinutes: 0, priceNis: "", priceMode: "fixed" };
const toDraft = (s: ServiceRow): Draft => ({ id: s.id, name: s.name, description: s.description ?? "", durationMinutes: s.duration_minutes, bufferMinutes: s.buffer_minutes, priceNis: String(fromCents(s.price_cents)), priceMode: s.price_mode ?? "fixed" });

export function ServicesManager({ services }: { services: ServiceRow[] }) {
  const t = useTranslations("settings.services");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; price?: string }>({});
  const [pending, start] = useTransition();
  const active = services.filter((s) => s.active);
  const archived = services.filter((s) => !s.active);

  function submit() {
    if (!draft) return;
    const price = draft.priceMode === "free" ? 0 : Number(draft.priceNis);
    const fe = {
      name: draft.name.trim().length < 2 ? t("errors.name") : undefined,
      price: draft.priceMode === "free" ? undefined : draft.priceNis.trim() === "" || !Number.isFinite(price) || price < 0 || price > 100_000 ? t("errors.price") : undefined,
    };
    setFieldErrors(fe);
    if (fe.name || fe.price) return;
    setError(null);
    start(async () => {
      const r = await saveServiceAction({ id: draft.id, name: draft.name, description: draft.description, durationMinutes: draft.durationMinutes, bufferMinutes: draft.bufferMinutes, priceNis: price, priceMode: draft.priceMode });
      if (!r.ok) return setError(r.code === "DUPLICATE" ? t("errors.duplicate") : r.code === "FORBIDDEN" ? t("errors.forbidden") : t("errors.generic"));
      toast(t("saved"), { variant: "success" });
      setDraft(null);
      router.refresh();
    });
  }

  function toggle(s: ServiceRow, makeActive: boolean) {
    start(async () => {
      const r = await setServiceActiveAction(s.id, makeActive);
      if (!r.ok) return toast(r.code === "DUPLICATE" ? t("errors.duplicate") : t("errors.generic"), { variant: "warning" });
      toast(makeActive ? t("restoredToast") : t("archivedToast"), { variant: "info" });
      router.refresh();
    });
  }

  const form = draft ? (
    <form
      noValidate
      aria-label={draft.id ? t("edit") : t("add")}
      className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5"
      data-testid="service-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormField label={t("name")} error={fieldErrors.name}>
        {(a) => <Input {...a} value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
      </FormField>
      <FormField label={t("description")}>
        {(a) => <Input {...a} value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t("duration")}>
          {(a) => (
            <NativeSelect {...a} value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })}>
              {(DURATION_OPTIONS.includes(draft.durationMinutes) ? DURATION_OPTIONS : [...DURATION_OPTIONS, draft.durationMinutes].sort((x, y) => x - y)).map((d) => (
                <option key={d} value={d}>{t("minutes", { minutes: d })}</option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t("buffer")}>
          {(a) => (
            <NativeSelect {...a} value={draft.bufferMinutes} onChange={(e) => setDraft({ ...draft, bufferMinutes: Number(e.target.value) })}>
              {BUFFER_OPTIONS.map((b) => (
                <option key={b} value={b}>{b === 0 ? t("bufferNone") : t("minutes", { minutes: b })}</option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t("priceMode")}>
          {(a) => (
            <NativeSelect {...a} value={draft.priceMode} onChange={(e) => setDraft({ ...draft, priceMode: e.target.value as Draft["priceMode"] })} data-testid="service-price-mode">
              <option value="fixed">{t("priceModes.fixed")}</option>
              <option value="from">{t("priceModes.from")}</option>
              <option value="free">{t("priceModes.free")}</option>
              <option value="hidden">{t("priceModes.hidden")}</option>
            </NativeSelect>
          )}
        </FormField>
        {draft.priceMode === "free" ? null : <FormField label={t("price")} error={fieldErrors.price}>
          {(a) => <Input {...a} type="number" inputMode="decimal" min={0} step="1" value={draft.priceNis} onChange={(e) => setDraft({ ...draft, priceNis: e.target.value })} />}
        </FormField>}
      </div>
      {error ? <p role="alert" className="text-sm font-medium text-destructive" data-testid="service-error">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{t("save")}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => { setDraft(null); setError(null); setFieldErrors({}); }}>{t("cancel")}</Button>
      </div>
    </form>
  ) : null;

  return (
    <div className="grid gap-6">
      {!draft ? (
        <Button className="justify-self-start" data-testid="add-service" onClick={() => { setDraft(blank); setError(null); setFieldErrors({}); }}>
          <Plus aria-hidden />
          {t("add")}
        </Button>
      ) : null}
      {draft && !draft.id ? form : null}

      {active.length === 0 && !draft ? (
        <EmptyState title={t("empty")} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" data-testid="service-list">
          {active.map((s) => (
            <li key={s.id} data-testid={`service-${s.id}`}>
              {draft?.id === s.id ? (
                <div className="p-3">{form}</div>
              ) : (
                <div className="grid gap-2 px-4 py-3.5 sm:flex sm:items-center sm:gap-3">
                  <div className="min-w-0 sm:flex-1">
                    <p className="font-semibold [overflow-wrap:anywhere]">{s.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("minutes", { minutes: s.duration_minutes })}
                      {s.buffer_minutes ? ` · +${t("minutes", { minutes: s.buffer_minutes })}` : ""} · {priceLabel(s.price_mode, fromCents(s.price_cents)) ?? t("priceModes.hidden")}
                    </p>
                  </div>
                  <div className="flex justify-start gap-1.5 sm:justify-end">
                    <Button variant="outline" size="sm" aria-label={`${t("edit")} · ${s.name}`} disabled={pending} onClick={() => { setDraft(toDraft(s)); setError(null); setFieldErrors({}); }}>
                      <Pencil aria-hidden />
                      {t("edit")}
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`${t("archive")} · ${s.name}`} disabled={pending} onClick={() => toggle(s, false)}>
                      <Archive aria-hidden />
                      {t("archive")}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <section aria-labelledby="archived-title" className="grid gap-2">
          <h2 id="archived-title" className="text-sm font-semibold text-muted-foreground">{t("archived")}</h2>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card/60" data-testid="archived-list">
            {archived.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <Button variant="ghost" size="sm" aria-label={`${t("restore")} · ${s.name}`} disabled={pending} onClick={() => toggle(s, true)}>
                  <RotateCcw aria-hidden />
                  {t("restore")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
