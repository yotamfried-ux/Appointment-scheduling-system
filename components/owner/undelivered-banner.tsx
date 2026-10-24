"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import type * as C from "@/lib/api/contracts";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { fmt } from "@/lib/lab/dashboard-data";
import { kindKey, reasonKey, splitUndelivered } from "@/lib/owner/undelivered";

type Item = z.infer<typeof C.OwnerAgendaResponse>["undeliveredItems"][number];
const COMPACT = 3;

/** Messages that did not reach a customer: who, which message, for when and why, in words (never colour alone). A customer with no e-mail address is a calm note, not a failure. */
export function UndeliveredBanner({ items, onOpenDay }: { items: Item[]; onOpenDay: (date: string) => void }) {
  const t = useTranslations("owner.agenda");
  const [all, setAll] = useState(false);
  const { failed, noEmail } = splitUndelivered(items);
  const shown = all ? failed : failed.slice(0, COMPACT);
  const when = (i: Item) => `${formatDayLabel(i.date)} ${fmt(i.start)}`;

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
      {noEmail.length > 0 ? (
        <section role="status" className="grid gap-1 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground" data-testid="no-email-note">
          <p>{t("noEmailNote", { count: noEmail.length })}</p>
          <ul className="grid gap-0.5">
            {noEmail.slice(0, COMPACT).map((i) => (
              <li key={i.id}><bdi>{i.customer}</bdi> · {t(`kind.${kindKey(i.kind)}`)} · <bdi>{when(i)}</bdi></li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
