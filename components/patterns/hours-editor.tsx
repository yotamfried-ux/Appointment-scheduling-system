"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { TimeRibbon } from "@/components/brand/time-ribbon";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { onboardingToMinutes as toMin, windowProblem, type DayHours } from "@/lib/lab/onboarding";
import { cn } from "@/lib/utils";

const TIMES = Array.from({ length: 37 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** Weekly opening hours: per-day switch, up to three windows per day, inline validation, ribbon preview. Controlled. */
export function HoursEditor({
  hours,
  onToggle,
  onSet,
  onAdd,
  onRemove,
  className,
}: {
  hours: DayHours[];
  onToggle: (weekday: number) => void;
  onSet: (weekday: number, index: number, from: string, to: string) => void;
  onAdd: (weekday: number) => void;
  onRemove: (weekday: number, index: number) => void;
  className?: string;
}) {
  const t = useTranslations("onboarding");
  return (
    <ul className={cn("divide-y rounded-lg border bg-card", className)}>
      {hours.map((h) => {
        const day = t(`hours.days.${h.weekday}`);
        const all = h.windows;
        const bounds = { from: Math.min(...all.map((w) => toMin(w.from))), to: Math.max(...all.map((w) => toMin(w.to))) };
        const valid = all.every((_, i) => windowProblem(all, i) === null);
        return (
          <li key={h.weekday} className="grid gap-3 px-4 py-4" data-testid={`hours-${h.weekday}`}>
            <div className="flex items-center justify-between gap-3">
              <span className={cn("font-semibold", !h.open && "text-muted-foreground")}>{day}</span>
              {h.open ? null : <span className="text-sm text-muted-foreground">{t("hours.closed")}</span>}
              <Switch
                className="ms-auto"
                checked={h.open}
                onCheckedChange={() => onToggle(h.weekday)}
                aria-label={t("hours.toggle", { day })}
              />
            </div>
            {h.open ? (
              <>
                {all.map((w, i) => {
                  const problem = windowProblem(all, i);
                  const suffix = all.length > 1 ? ` ${t("hours.window", { n: i + 1 })}` : "";
                  return (
                    <div key={i} className="grid gap-2" data-testid={`window-${h.weekday}-${i}`}>
                      <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-3">
                        <NativeSelect
                          aria-label={`${t("hours.from")} ${day}${suffix}`}
                          value={w.from}
                          onChange={(e) => onSet(h.weekday, i, e.target.value, w.to)}
                        >
                          {TIMES.map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </NativeSelect>
                        <NativeSelect
                          aria-label={`${t("hours.to")} ${day}${suffix}`}
                          aria-invalid={problem ? true : undefined}
                          value={w.to}
                          onChange={(e) => onSet(h.weekday, i, w.from, e.target.value)}
                        >
                          {TIMES.map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </NativeSelect>
                        {all.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`${t("hours.removeWindow")} ${day}${suffix}`}
                            onClick={() => onRemove(h.weekday, i)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                      {problem ? (
                        <p role="alert" className="text-sm font-medium text-destructive">
                          {problem === "order" ? t("hours.error") : t("hours.overlap")}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {valid ? (
                  <TimeRibbon
                    from={Math.min(bounds.from, 6 * 60)}
                    to={Math.max(bounds.to, 22 * 60)}
                    segments={all.map((w) => ({ start: toMin(w.from), end: toMin(w.to), state: "free" as const }))}
                    height="sm"
                    ticks={false}
                    label={`${day} ${all.map((w) => `${w.from}–${w.to}`).join(", ")}`}
                  />
                ) : null}
                {all.length < 3 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-self-start text-muted-foreground"
                    onClick={() => onAdd(h.weekday)}
                  >
                    <Plus aria-hidden />
                    {t("hours.addWindow")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
