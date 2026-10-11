import { cn } from "@/lib/utils";
import { ribbonGeometry, ribbonSummary, type RibbonSegment, type RibbonState } from "@/lib/ribbon";

const LABELS_HE: Record<RibbonState, string> = { booked: "תפוס", free: "פנוי", pending: "ממתין לאישור", closed: "סגור", selected: "נבחר" };

/**
 * The product's signature element (docs/07 §4): the working day as a strip of segments.
 * Time flows from the inline-start edge, so in Hebrew the morning is on the right.
 * Accessible: role="img" + a text summary; each state also has its own texture, not only a colour.
 */
export function TimeRibbon({
  from,
  to,
  segments,
  now,
  tickEvery = 1,
  height = "md",
  labels = LABELS_HE,
  className,
  label,
  ticks = true,
  legend = false,
}: {
  from: number;
  to: number;
  segments: RibbonSegment[];
  now?: number;
  tickEvery?: number;
  height?: "sm" | "md" | "lg";
  labels?: Record<RibbonState, string>;
  className?: string;
  label?: string;
  ticks?: boolean;
  legend?: boolean;
}) {
  const boxes = ribbonGeometry(segments, from, to);
  const summary = ribbonSummary(segments, labels);
  const nowPct = now !== undefined && now >= from && now <= to ? ((now - from) / (to - from)) * 100 : null;
  const hours: number[] = [];
  for (let m = Math.ceil(from / 60) * 60; m <= to; m += tickEvery * 60) hours.push(m);

  return (
    <figure className={cn("w-full", className)}>
      <div role="img" aria-label={[label, summary].filter(Boolean).join(". ")} className="relative">
        <div className={cn("relative overflow-hidden rounded-md border bg-muted/60", height === "sm" ? "h-6" : height === "md" ? "h-10" : "h-14")}>
          {boxes.map((b, i) => (
            <div
              key={i}
              className={cn(
                "absolute inset-y-0.5 rounded-[5px] motion-safe:animate-[ribbon-in_320ms_var(--ease-out)_backwards]",
                b.state === "booked" && "ribbon-booked",
                b.state === "free" && "ribbon-free",
                b.state === "pending" && "ribbon-pending",
                b.state === "closed" && "ribbon-closed",
                b.state === "selected" && "ribbon-selected z-10",
              )}
              style={{ insetInlineStart: `calc(${b.start}% + 1px)`, width: `calc(${b.size}% - 2px)`, animationDelay: `${i * 40}ms` }}
            />
          ))}
          {nowPct !== null ? (
            <div className="absolute inset-y-0 z-20 w-0.5 bg-destructive" style={{ insetInlineStart: `${nowPct}%` }}>
              <span className="absolute -top-0.5 -start-[3px] size-2 rounded-full bg-destructive" />
            </div>
          ) : null}
        </div>
        {ticks ? (
          <div className="relative mt-1.5 h-4 text-xs text-muted-foreground" aria-hidden>
            {hours.map((m) => (
              <span
                key={m}
                className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full tabular-nums rtl:translate-x-1/2 rtl:first:translate-x-0 rtl:last:translate-x-full"
                style={{ insetInlineStart: `${((m - from) / (to - from)) * 100}%` }}
              >
                <bdi>{String(m / 60).padStart(2, "0")}</bdi>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {legend ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
          {(["booked", "free", "pending"] as const)
            .filter((st) => segments.some((x) => x.state === st))
            .map((st) => (
              <li key={st} className="flex items-center gap-1.5">
                <span className={cn("inline-block h-3 w-5 rounded-[3px]", st === "booked" && "ribbon-booked", st === "free" && "ribbon-free", st === "pending" && "ribbon-pending")} />
                {labels[st]}
              </li>
            ))}
        </ul>
      ) : null}
    </figure>
  );
}
