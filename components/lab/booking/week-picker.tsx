"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ChoiceCard } from "@/components/patterns/choice-card";
import { Button } from "@/components/ui/button";
import type { LabDay } from "@/lib/lab/booking-data";
import { LAB_TIMEZONE } from "@/lib/lab/booking-data";
import { cn } from "@/lib/utils";

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("he-IL", { ...o, timeZone: LAB_TIMEZONE }).format(new Date(`${iso}T12:00:00Z`));

/**
 * Seven days at a time, no hidden horizontal scroller: every option is visible, reachable
 * by keyboard (radio group) and ≥44px tall. Availability is shown by a dot AND text for AT.
 */
export function WeekPicker({
  days,
  value,
  onChange,
  hasFree,
  today,
}: {
  days: LabDay[];
  value: string | null;
  onChange: (iso: string) => void;
  hasFree: (iso: string) => boolean;
  today: string;
}) {
  const t = useTranslations("booking.day");
  const [page, setPage] = useState(0);
  const pages = Math.ceil(days.length / 7);
  const week = days.slice(page * 7, page * 7 + 7);
  const month = fmt(week[0].iso, { month: "long", year: "numeric" });

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold" aria-live="polite">{month}</p>
        <div className="flex gap-1.5">
          <Button type="button" variant="outline" size="icon" aria-label={t("prevWeek")} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronRight aria-hidden />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label={t("nextWeek")} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            <ChevronLeft aria-hidden />
          </Button>
        </div>
      </div>
      <fieldset>
        <legend className="sr-only">{t("pick")}</legend>
        <div className="grid grid-cols-7 gap-1.5">
          {week.map((d) => {
            const free = !d.closed && hasFree(d.iso);
            const disabled = d.closed || !free;
            return (
              <ChoiceCard
                key={d.iso}
                variant="chip"
                name="day"
                value={d.iso}
                checked={value === d.iso}
                disabled={disabled}
                onChange={onChange}
                className="flex-col gap-0.5 px-0 py-2"
                testId={`day-${d.iso}`}
              >
                <span className="text-xs opacity-80">{fmt(d.iso, { weekday: "narrow" })}</span>
                <span className="text-lg leading-none font-semibold">{fmt(d.iso, { day: "numeric" })}</span>
                <span className={cn("mt-0.5 size-1.5 rounded-full", free ? "bg-current" : "bg-transparent")} aria-hidden />
                <span className="sr-only">
                  {d.iso === today ? `${t("today")}, ` : ""}
                  {free ? t("open") : d.closed ? t("closedSr") : t("noneFree")}
                </span>
              </ChoiceCard>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
