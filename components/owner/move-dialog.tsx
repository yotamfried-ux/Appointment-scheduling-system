"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { ApiClientError, ownerApi } from "@/lib/api/client";
import { fmt } from "@/lib/lab/dashboard-data";

/** RSC-04: move one booking to another time. The customer is told by mail and can decline without any condition. */
export function MoveDialog({ id, customer, date, start, people = [], personId, onClose, onDone }: { id: string; customer: string; date: string; start: number; people?: { id: string; name: string }[]; personId?: string; onClose: () => void; onDone: (date: string) => void }) {
  const t = useTranslations("owner.move");
  const [d, setD] = useState(date);
  const [time, setTime] = useState(fmt(start));
  const [person, setPerson] = useState(personId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!d || !time) return setError(t("required"));
    setBusy(true);
    setError(null);
    try {
      const r = await ownerApi.move(id, { date: d, time, ...(person && person !== personId ? { personId: person } : {}) });
      toast(r.outOfHours ? t("movedOutOfHours") : t("moved"), { variant: r.outOfHours ? "info" : "success" });
      onDone(d);
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError && ["SLOT_TAKEN", "INVALID_TRANSITION", "INVALID_SLOT", "VALIDATION_FAILED"].includes(err.code) ? err.message : t("generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{t("title", { name: customer })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={submit} noValidate className="grid gap-4" data-testid="move-form">
          {people.length > 1 ? (
            <FormField label={t("person")} error={undefined}>
              {(a) => (
                <NativeSelect {...a} value={person} onChange={(e) => setPerson(e.target.value)} data-testid="move-person">
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
              )}
            </FormField>
          ) : null}
          <FormField label={t("date")} error={undefined}>
            {(a) => <Input {...a} type="date" dir="ltr" className="text-start" value={d} onChange={(e) => setD(e.target.value)} data-testid="move-date" />}
          </FormField>
          <FormField label={t("time")} error={undefined}>
            {(a) => <Input {...a} type="time" step={300} dir="ltr" className="text-start" value={time} onChange={(e) => setTime(e.target.value)} data-testid="move-time" />}
          </FormField>
          {error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive" data-testid="move-error">{error}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy} data-testid="move-submit">{busy ? t("moving") : t("submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
