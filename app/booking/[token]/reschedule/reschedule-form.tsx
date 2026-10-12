"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { rescheduleAppointmentAction } from "@/app/booking/[token]/actions";
import { Button } from "@/components/ui/button";
import { formatDayLabel } from "@/lib/lab/booking-data";
import { labApi } from "@/lib/api/client";

export function RescheduleForm({ slug, serviceId, initialToken, manageHref }: { slug: string; serviceId: string; initialToken: string; manageHref: string }) {
  const t = useTranslations("reschedule");
  const router = useRouter();
  const opts = { kind: "other", session: "public", base: `/api/public/${slug}` } as const;
  const [token, setToken] = useState(initialToken);
  const [days, setDays] = useState<string[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [times, setTimes] = useState<string[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const from = new Date().toISOString().slice(0, 10);
    labApi.availability(opts, { service: serviceId, from, days: 30 }).then((r) => setDays(r.days.filter((d) => d.freeSlots > 0).map((d) => d.date))).catch(() => setDays([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, slug]);

  const pickDay = (d: string) => {
    setDate(d); setTime(null); setTimes(null); setMessage(null);
    labApi.slots(opts, { service: serviceId, date: d }).then((r) => setTimes(r.slots.map((s) => s.time))).catch(() => setTimes([]));
  };

  const submit = () =>
    start(async () => {
      if (!date || !time) return;
      const r = await rescheduleAppointmentAction(token, date, time);
      if (r.nextToken) setToken(r.nextToken);
      if (r.outcome === "moved") return router.push(manageHref);
      if (r.outcome === "slot_taken") { if (date) pickDay(date); setMessage(t("taken")); return; } // reload the day first (it clears the message), then say why
      setMessage(r.outcome === "too_late" ? t("tooLate") : r.outcome === "limit" ? t("limit") : r.outcome === "rate_limited" ? t("rate") : t("failed"));
    });

  return (
    <div className="grid gap-5">
      <section aria-labelledby="resched-days" className="grid gap-2">
        <h2 id="resched-days" className="font-semibold">{t("pickDay")}</h2>
        {days === null ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : days.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="resched-none">{t("none")}</p> : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {days.map((d) => (
              <li key={d}>
                <button type="button" aria-pressed={date === d} onClick={() => pickDay(d)} data-testid={`resched-day-${d}`}
                  className={`min-h-11 w-full rounded-md border px-2 text-sm font-medium ${date === d ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{formatDayLabel(d, "short")}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {date ? (
        <section aria-labelledby="resched-times" className="grid gap-2">
          <h2 id="resched-times" className="font-semibold">{t("pickTime")}</h2>
          {times === null ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : times.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {times.map((x) => (
                <li key={x}>
                  <button type="button" aria-pressed={time === x} onClick={() => setTime(x)} data-testid={`resched-time-${x}`}
                    className={`min-h-11 w-full rounded-md border px-2 text-sm font-medium ${time === x ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}><bdi>{x}</bdi></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {message ? <p role="alert" className="text-sm font-medium text-destructive" data-testid="resched-error">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" disabled={!date || !time || pending} onClick={submit} data-testid="resched-confirm">{pending ? t("moving") : t("confirm")}</Button>
        <a href={manageHref} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-semibold hover:bg-accent">{t("back")}</a>
      </div>
    </div>
  );
}
