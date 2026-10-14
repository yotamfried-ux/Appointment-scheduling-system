"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

export function NotesForm({ id, initial }: { id: string; initial: string }) {
  const t = useTranslations("customers.detail");
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/customers/${id}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes: value }) });
      if (!res.ok) throw new Error(String(res.status));
      toast(t("notesSaved"), { variant: "success" });
    } catch {
      toast(t("notesError"), { variant: "warning" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-2 rounded-lg border bg-card p-4">
      <Label htmlFor="notes" className="font-semibold">{t("notes")}</Label>
      <Textarea id="notes" value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} rows={3} aria-describedby="notes-hint" data-testid="customer-notes" />
      <p id="notes-hint" className="text-xs text-muted-foreground">{t("notesHint")}</p>
      <div><Button type="submit" disabled={busy} data-testid="customer-notes-save">{t("notesSave")}</Button></div>
    </form>
  );
}
