"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { MailPlus, X } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ownerApi } from "@/lib/api/client";
import type * as C from "@/lib/api/contracts";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { fmt } from "@/lib/lab/dashboard-data";
import { kindKey, reasonKey, splitUndelivered } from "@/lib/owner/undelivered";

type Item = z.infer<typeof C.OwnerAgendaResponse>["undeliveredItems"][number];
const COMPACT = 3;

/** Messages that did not reach a customer: who, which message, for when and why, in words (never colour alone). A customer with no e-mail address is a calm note with actionable options, dismissible so it does not float forever. */
export function UndeliveredBanner({ items, onOpenDay }: { items: Item[]; onOpenDay: (date: string) => void }) {
  const t = useTranslations("owner.agenda");
  const [all, setAll] = useState(false);
  const [noteDismissed, setNoteDismissed] = useState(false);
  const [activeCustomerAddEmail, setActiveCustomerAddEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [resolvedCustomerIds, setResolvedCustomerIds] = useState<Set<string>>(new Set());

  // Check if owner dismissed the note during this session
  useEffect(() => {
    try {
      if (sessionStorage.getItem("dismiss_no_email_note") === "1") {
        setNoteDismissed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  function dismissNote() {
    setNoteDismissed(true);
    try {
      sessionStorage.setItem("dismiss_no_email_note", "1");
    } catch {
      // ignore
    }
  }

  const { failed, noEmail: rawNoEmail } = splitUndelivered(items);
  const noEmail = rawNoEmail.filter((i) => !i.customerId || !resolvedCustomerIds.has(i.customerId));
  const shown = all ? failed : failed.slice(0, COMPACT);
  const when = (i: Item) => `${formatDayLabel(i.date)} ${fmt(i.start)}`;

  async function handleAddEmail(e: React.FormEvent, item: Item) {
    e.preventDefault();
    if (!item.customerId || !emailInput.trim() || savingEmail) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())) {
      toast("כתובת האימייל אינה תקינה.", { variant: "error" });
      return;
    }
    setSavingEmail(true);
    try {
      await ownerApi.updateCustomer(item.customerId, {
        fullName: item.customer,
        phone: "+972500000000", // backend keeps existing phone if phone untouched, or we pass phone
        email: emailInput.trim(),
      });
      toast("כתובת האימייל נוספה בהצלחה ללקוח", { variant: "success" });
      setResolvedCustomerIds((prev) => new Set([...prev, item.customerId!]));
      setActiveCustomerAddEmail(null);
      setEmailInput("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "שגיאה בעדכון האימייל";
      toast(msg, { variant: "error" });
    } finally {
      setSavingEmail(false);
    }
  }

  return (
    <>
      {failed.length > 0 ? (
        <section role="status" className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" data-testid="undelivered">
          <p className="font-medium">{t("undelivered", { count: failed.length })}</p>
          <ul className="grid gap-2">
            {shown.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="undelivered-item">
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium"><bdi>{i.customer}</bdi> · {t(`kind.${kindKey(i.kind)}`)} · <bdi>{when(i)}</bdi></span>
                  <span>{t("undeliveredWhy", { reason: t(`reason.${reasonKey(i.code)}`) })}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onOpenDay(i.date)} data-testid={`undelivered-open-${i.id}`}>{t("undeliveredOpen")}</Button>
              </li>
            ))}
          </ul>
          {failed.length > COMPACT ? (
            <Button size="sm" variant="ghost" className="justify-self-start" aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="undelivered-toggle">
              {all ? t("undeliveredShowLess") : t("undeliveredShowAll", { count: failed.length })}
            </Button>
          ) : null}
        </section>
      ) : null}

      {noEmail.length > 0 && !noteDismissed ? (
        <section role="status" className="relative grid gap-2 rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-muted-foreground" data-testid="no-email-note">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-foreground">{t("noEmailNote", { count: noEmail.length })}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismissNote}
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              aria-label="הסתרת ההודעה"
              data-testid="dismiss-no-email-note"
            >
              <X className="size-4" />
            </Button>
          </div>
          <ul className="grid gap-2">
            {noEmail.slice(0, COMPACT).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-1.5 last:border-b-0 last:pb-0">
                <span>
                  <bdi className="font-medium text-foreground">{i.customer}</bdi> · {t(`kind.${kindKey(i.kind)}`)} · <bdi>{when(i)}</bdi>
                </span>
                <div className="flex items-center gap-2">
                  {i.customerId ? (
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs px-2.5">
                      <Link href={`/customers/${i.customerId}`}>כרטיס לקוח</Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
            <Link href="/customers?filter=missing_email" className="text-primary hover:underline font-medium">
              צפייה בכל הלקוחות ללא כתובת אימייל במאגר ←
            </Link>
            <Button type="button" variant="ghost" size="sm" onClick={dismissNote} className="h-6 text-xs text-muted-foreground">
              הסתרת הודעה זו מהדשבורד
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
