"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { TimeRibbon } from "@/components/brand/time-ribbon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  isValidHHmm,
  onboardingToMinutes as toMin,
  windowProblem,
  windowShorterThanService,
  type DayHours,
} from "@/lib/lab/onboarding";
import { cn } from "@/lib/utils";

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const QUICK_FROM_TIMES = Array.from({ length: 48 }, (_, i) => fmt(i * 30));
const QUICK_TO_TIMES = Array.from({ length: 48 }, (_, i) => fmt((i + 1) * 30));

function optionsWithCurrent(base: string[], current: string, allow24End: boolean): string[] {
  if (base.includes(current)) return base;
  if (isValidHHmm(current, allow24End)) {
    return [...base, current].sort((a, b) => toMin(a) - toMin(b));
  }
  return [current, ...base];
}

/** Weekly opening hours: per-day switch, unlimited windows per day, quick-pick + manual HH:MM minute entry, and inline validation. */
export function HoursEditor({
  hours,
  onToggle,
  onSet,
  onAdd,
  onRemove,
  minServiceDuration,
  className,
}: {
  hours: DayHours[];
  onToggle: (weekday: number) => void;
  onSet: (weekday: number, index: number, from: string, to: string) => void;
  onAdd: (weekday: number) => void;
  onRemove: (weekday: number, index: number) => void;
  minServiceDuration?: number;
  className?: string;
}) {
  const t = useTranslations("onboarding");
  return (
    <ul className={cn("divide-y rounded-lg border bg-card", className)}>
      {hours.map((h) => {
        const day = t(`hours.days.${h.weekday}`);
        const all = h.windows;
        const valid = all.every((_, i) => windowProblem(all, i) === null);
        const bounds = valid
          ? { from: Math.min(...all.map((w) => toMin(w.from))), to: Math.max(...all.map((w) => toMin(w.to))) }
          : { from: 6 * 60, to: 22 * 60 };
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
                  const tooShort = !problem && windowShorterThanService(w, minServiceDuration);
                  const suffix = all.length > 1 ? ` ${t("hours.window", { n: i + 1 })}` : "";
                  const fromOptions = optionsWithCurrent(QUICK_FROM_TIMES, w.from, false);
                  const toOptions = optionsWithCurrent(QUICK_TO_TIMES, w.to, true);
                  return (
                    <div key={i} className="grid gap-2" data-testid={`window-${h.weekday}-${i}`}>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:gap-3">
                        <div className="grid grid-cols-[1fr_5.5rem] items-center gap-1.5">
                          <NativeSelect
                            aria-label={`${t("hours.from")} ${day}${suffix}`}
                            value={w.from}
                            onChange={(e) => onSet(h.weekday, i, e.target.value, w.to)}
                          >
                            {fromOptions.map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </NativeSelect>
                          <Input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            maxLength={5}
                            placeholder="HH:MM"
                            className="px-2 text-center font-mono text-sm tabular-nums"
                            aria-label={`הזנה ידנית של שעת התחלה ${day}${suffix}`}
                            data-testid={`manual-from-${h.weekday}-${i}`}
                            value={w.from}
                            onChange={(e) => onSet(h.weekday, i, e.target.value, w.to)}
                          />
                        </div>
                        <div className="grid grid-cols-[1fr_5.5rem] items-center gap-1.5">
                          <NativeSelect
                            aria-label={`${t("hours.to")} ${day}${suffix}`}
                            aria-invalid={problem ? true : undefined}
                            value={w.to}
                            onChange={(e) => onSet(h.weekday, i, w.from, e.target.value)}
                          >
                            {toOptions.map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </NativeSelect>
                          <Input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            maxLength={5}
                            placeholder="HH:MM"
                            className="px-2 text-center font-mono text-sm tabular-nums"
                            aria-label={`הזנה ידנית של שעת סיום ${day}${suffix}`}
                            aria-invalid={problem ? true : undefined}
                            data-testid={`manual-to-${h.weekday}-${i}`}
                            value={w.to}
                            onChange={(e) => onSet(h.weekday, i, w.from, e.target.value)}
                          />
                        </div>
                        {all.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`${t("hours.removeWindow")} ${day}${suffix}`}
                            data-testid={`remove-window-${h.weekday}-${i}`}
                            onClick={() => onRemove(h.weekday, i)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                      {problem ? (
                        <p role="alert" className="text-sm font-medium text-destructive">
                          {problem === "format"
                            ? "יש להזין שעה תקינה בפורמט HH:MM (למשל 09:15)."
                            : problem === "order"
                              ? t("hours.error")
                              : t("hours.overlap")}
                        </p>
                      ) : null}
                      {tooShort ? (
                        <p
                          role="status"
                          data-testid={`short-window-${h.weekday}-${i}`}
                          className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
                        >
                          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                          <span>
                            טווח השעות ({w.from}–{w.to}) קצר ממשך השירות ({minServiceDuration} דק׳) ולכן לא ייווצרו בו תורים זמינים.
                          </span>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-self-start text-muted-foreground"
                  data-testid={`add-window-${h.weekday}`}
                  onClick={() => onAdd(h.weekday)}
                >
                  <Plus aria-hidden />
                  {t("hours.addWindow")}
                </Button>
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
