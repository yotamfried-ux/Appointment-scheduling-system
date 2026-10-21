import { cn } from "@/lib/utils";

export interface BarPoint {
  /** Short axis label (may be empty for bars that should not be labelled). */
  label: string;
  value: number;
  /** Full text for the tooltip and the screen-reader table, e.g. "יום שלישי 3.3 · 4 תורים". */
  text: string;
}

/**
 * Dependency-free bar chart. Bars are SVG (they scale with the container), labels are HTML (they stay crisp and wrap with the text direction).
 * Points are given earliest first; in a right-to-left page the first point is drawn at the right edge, as readers expect time to flow.
 * Accessible by construction: the figure has a title and description, and the same numbers are available as a table for assistive technology.
 */
export function BarChart({ title, description, points, tableHeaders, tone = "primary", testId, className }: {
  title: string;
  description?: string;
  points: BarPoint[];
  tableHeaders: [string, string];
  tone?: "primary" | "accent";
  testId?: string;
  className?: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const W = 1000;
  const H = 160;
  const gap = points.length > 40 ? 1 : 4;
  const bw = Math.max(1, (W - gap * (points.length - 1)) / Math.max(points.length, 1));
  const labelled = points.map((p, i) => ({ p, i })).filter(({ p, i }) => p.label && (points.length <= 8 || i === 0 || i === points.length - 1 || i === Math.floor((points.length - 1) / 2)));
  return (
    <figure className={cn("min-w-0 rounded-lg border bg-card p-4 sm:p-5", className)} data-testid={testId}>
      <figcaption className="mb-3">
        <span className="block text-sm font-semibold">{title}</span>
        {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={title} className="h-36 w-full">
        <title>{title}</title>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const h = p.value === 0 ? 0 : Math.max(3, (p.value / max) * (H - 8));
          // dir="ltr" keeps the geometry predictable; mirror the index so the earliest point sits at the right in an RTL page.
          const x = (points.length - 1 - i) * (bw + gap);
          return (
            <rect key={i} x={x} y={H - h} width={bw} height={h} rx="2" className={tone === "primary" ? "fill-primary" : "fill-accent-foreground/70"} data-value={p.value}>
              <title>{p.text}</title>
            </rect>
          );
        })}
      </svg>
      <div className="relative mt-1 h-5 text-xs text-muted-foreground" aria-hidden>
        {labelled.map(({ p, i }) => {
          const center = ((points.length - 1 - i) * (bw + gap) + bw / 2) / W;
          return (
            <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: `${Math.min(Math.max(center * 100, 4), 96)}%` }}>{p.label}</span>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">{tableHeaders[0]}</th><th scope="col">{tableHeaders[1]}</th></tr></thead>
        <tbody>{points.map((p, i) => <tr key={i}><th scope="row">{p.text.split(" · ")[0]}</th><td>{p.text.split(" · ").slice(1).join(" · ") || p.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
