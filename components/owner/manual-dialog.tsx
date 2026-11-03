"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Search, UserCheck, X } from "lucide-react";
import { FormField } from "@/components/patterns/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ApiClientError, ownerApi } from "@/lib/api/client";
import { fmt } from "@/lib/lab/dashboard-data";
import { formatPhone } from "@/lib/phone";

export interface ManualService {
  id: string;
  name: string;
  durationMinutes: number;
  personIds?: string[] | null;
  locations?: ("business" | "customer" | "online")[] | null;
}

const FIELD: Record<string, "service" | "date" | "time" | "name" | "phone" | "email" | "note" | "location"> = {
  serviceId: "service",
  date: "date",
  time: "time",
  "customer.fullName": "name",
  "customer.phone": "phone",
  "customer.email": "email",
  note: "note",
  location: "location",
};

interface CustomerSearchResult {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  lastVisit: string | null;
}

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
  const [form, setForm] = useState<{
    service: string;
    person: string;
    date: string;
    time: string;
    location: "business" | "customer" | "online";
    name: string;
    phone: string;
    email: string;
    note: string;
  }>({
    service: "",
    person: defaultPerson,
    date,
    time,
    location: "business",
    name: "",
    phone: "",
    email: "",
    note: "",
  });
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset when dialog re-opens
  useEffect(() => {
    if (open) {
      setForm({ service: "", person: defaultPerson, date, time, location: "business", name: "", phone: "", email: "", note: "" });
      setSelectedCustomerId(null);
      setSearchQuery("");
      setSearchResults([]);
      setErrors({});
      setFormError(null);
    }
  }, [open, date, time, defaultPerson]);

  // Debounced customer search
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const ac = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await ownerApi.searchCustomers(q, ac.signal);
        setSearchResults(results);
      } catch {
        // ignore aborts or errors
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [searchQuery]);

  const selectedService = useMemo(() => services.find((s) => s.id === form.service) ?? null, [services, form.service]);
  const allowedLocations = useMemo<("business" | "customer" | "online")[]>(() => {
    if (selectedService?.locations && selectedService.locations.length > 0) {
      return selectedService.locations;
    }
    return ["business", "online"];
  }, [selectedService]);
  const effectiveLocation = allowedLocations.includes(form.location) ? form.location : (allowedLocations[0] ?? "business");

  const eligiblePeople = useMemo(() => {
    if (!selectedService?.personIds || selectedService.personIds.length === 0) return people;
    return people.filter((p) => selectedService.personIds!.includes(p.id));
  }, [people, selectedService]);
  const effectivePerson = form.person && eligiblePeople.some((p) => p.id === form.person) ? form.person : "";

  function pickExistingCustomer(c: CustomerSearchResult) {
    setSelectedCustomerId(c.id);
    setForm((prev) => ({
      ...prev,
      name: c.fullName,
      phone: c.phone,
      email: c.email ?? "",
    }));
    setSearchQuery("");
    setSearchResults([]);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.name;
      delete next.phone;
      return next;
    });
  }

  function clearSelectedCustomer() {
    setSelectedCustomerId(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    if (!form.service) next.service = t("required");
    if (!form.date) next.date = t("required");
    if (!form.time) next.time = t("required");
    if (!form.name.trim()) next.name = t("required");
    if (!form.phone.trim()) next.phone = t("required");
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = "כתובת האימייל אינה תקינה.";
    }
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const r = await ownerApi.createManual({
        serviceId: form.service,
        date: form.date,
        time: form.time,
        location: effectiveLocation,
        customerId: selectedCustomerId ?? undefined,
        customer: {
          fullName: form.name.trim(),
          phone: form.phone.trim(),
        },
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={submit} noValidate className="grid gap-4" data-testid="manual-form">
          <FormField label={t("service")} error={errors.service}>
            {(a) => (
              <NativeSelect
                {...a}
                value={form.service}
                onChange={(e) => {
                  const svc = services.find((s) => s.id === e.target.value);
                  const nextLoc = svc?.locations?.[0] ?? form.location;
                  setForm({ ...form, service: e.target.value, location: nextLoc });
                }}
                data-testid="manual-service"
              >
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
          <FormField label="אופן מפגש" error={errors.location}>
            {(a) => (
              <NativeSelect
                {...a}
                value={effectiveLocation}
                onChange={(e) => setForm({ ...form, location: e.target.value as "business" | "customer" | "online" })}
                data-testid="manual-modality"
              >
                {allowedLocations.includes("business") ? <option value="business">פרונטלי</option> : null}
                {allowedLocations.includes("online") ? <option value="online">אונליין</option> : null}
                {allowedLocations.includes("customer") ? <option value="customer">פרונטלי (אצל הלקוח)</option> : null}
              </NativeSelect>
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
            <FormField label={t("date")} error={errors.date}>
              {(a) => <Input {...a} type="date" dir="ltr" className="text-start" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="manual-date" />}
            </FormField>
            <FormField label={t("time")} error={errors.time}>
              {(a) => <Input {...a} type="time" step={60} dir="ltr" className="text-start" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} data-testid="manual-time" />}
            </FormField>
          </div>
          {windows.length > 0 && form.date === date ? (
            <p className="text-xs text-muted-foreground">
              שעות הפעילות ביום זה: <bdi className="font-semibold tabular-nums">{windows.map((w) => `${fmt(w.from)}–${fmt(w.to)}`).join(" · ")}</bdi>
            </p>
          ) : null}

          {/* Customer Selection from Repository */}
          <div className="rounded-lg border bg-muted/30 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">פרטי הלקוח</span>
              {selectedCustomerId ? (
                <Badge variant="secondary" className="gap-1 font-normal text-xs">
                  <UserCheck className="size-3 text-primary" />
                  לקוח קיים מתוך המאגר
                </Badge>
              ) : null}
            </div>

            {selectedCustomerId ? (
              <div className="flex items-center justify-between rounded-md border bg-card p-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{form.name}</p>
                  <p className="text-xs text-muted-foreground font-mono" dir="ltr">{formatPhone(form.phone)}</p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={clearSelectedCustomer} className="h-8 gap-1 text-xs">
                  <X className="size-3.5" />
                  החלף לקוח
                </Button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    type="search"
                    autoComplete="off"
                    placeholder="חיפוש לקוח קיים לפי שם או טלפון…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="ps-9 pe-3 text-sm h-10"
                    data-testid="manual-customer-search"
                  />
                </div>
                {searchResults.length > 0 ? (
                  <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg divide-y divide-border">
                    {searchResults.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => pickExistingCustomer(c)}
                          className="flex w-full items-center justify-between gap-2 p-2 text-start text-xs hover:bg-accent rounded-sm transition-colors"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold block truncate">{c.fullName}</span>
                            <span className="text-muted-foreground block truncate" dir="ltr">{formatPhone(c.phone)}</span>
                          </div>
                          {c.email ? (
                            <span className="text-[11px] text-muted-foreground truncate max-w-[140px]" dir="ltr">{c.email}</span>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground border-dashed">בלי אימייל</Badge>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : searchQuery.trim().length >= 2 && !searching ? (
                  <p className="mt-1.5 text-xs text-muted-foreground ps-1">
                    לא נמצא לקוח תואם. מלאו את הפרטים למטה כדי להוסיף לקוח חדש:
                  </p>
                ) : null}
              </div>
            )}

            <div className="grid gap-3 pt-1">
              <FormField label={t("name")} error={errors.name}>
                {(a) => (
                  <Input
                    {...a}
                    autoComplete="off"
                    maxLength={80}
                    value={form.name}
                    onChange={(e) => {
                      if (selectedCustomerId) setSelectedCustomerId(null);
                      setForm({ ...form, name: e.target.value });
                    }}
                    data-testid="manual-name"
                  />
                )}
              </FormField>
              <FormField label={t("phone")} error={errors.phone}>
                {(a) => (
                  <Input
                    {...a}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    dir="ltr"
                    className="text-start"
                    value={form.phone}
                    onChange={(e) => {
                      if (selectedCustomerId) setSelectedCustomerId(null);
                      setForm({ ...form, phone: e.target.value });
                    }}
                    data-testid="manual-phone"
                  />
                )}
              </FormField>
              <FormField label="כתובת אימייל (אופציונלי)" hint="לשליחת אישור תור ותזכורות" error={errors.email}>
                {(a) => (
                  <Input
                    {...a}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    dir="ltr"
                    className="text-start"
                    placeholder="name@example.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    data-testid="manual-email"
                  />
                )}
              </FormField>
            </div>
          </div>

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
