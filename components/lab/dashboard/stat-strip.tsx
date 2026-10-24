import { cn } from "@/lib/utils";

export interface Stat {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "attention";
}

/** Metrics as typography, not boxes: big number, quiet label, hairline separators. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-card p-4 sm:p-5">
          <dt className="text-sm text-muted-foreground">{s.label}</dt>
          <dd className="mt-1">
            <span className={cn("text-3xl leading-none font-semibold tracking-tight tabular-nums", s.tone === "attention" && "underline decoration-2 underline-offset-4")}>{s.value}</span>
            <span className="mt-1.5 block text-xs text-muted-foreground">{s.hint}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
