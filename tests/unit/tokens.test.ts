import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Design-token contrast gate (WCAG 2.2 AA). Parses app/globals.css — the single source of truth —
// so a token edit that breaks accessibility fails CI instead of reaching users.
const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`block ${selector} not found`);
  const end = css.indexOf("\n}", start);
  const vars: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]] = m[2];
  return vars;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, minimum ratio]. 4.5 = text, 3 = UI boundary / focus indicator.
const PAIRS: [string, string, number][] = [
  ["foreground", "background", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["primary", "background", 4.5], // links and text-primary on page background
  ["primary", "card", 4.5],
  ["success-foreground", "success", 4.5],
  ["success-soft-foreground", "success-soft", 4.5],
  ["warning-foreground", "warning", 4.5],
  ["warning-soft-foreground", "warning-soft", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["destructive-soft-foreground", "destructive-soft", 4.5],
  ["info-soft-foreground", "info-soft", 4.5],
  ["neutral-soft-foreground", "neutral-soft", 4.5],
  ["success", "card", 4.5],
  ["destructive", "card", 4.5],
  ["input", "card", 3],
  ["input", "background", 3],
  ["ring", "background", 3],
  ["ring", "card", 3],
];

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
])("%s theme tokens meet WCAG AA", (_name, selector) => {
  const t = block(selector);

  it("defines every token used by the pairs", () => {
    for (const [fg, bg] of PAIRS) {
      expect(t[fg], `--${fg}`).toBeDefined();
      expect(t[bg], `--${bg}`).toBeDefined();
    }
  });

  it.each(PAIRS)("%s on %s ≥ %s:1", (fg, bg, min) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe("contrast helper (negative control)", () => {
  it("rejects a known-bad pair and accepts black on white", () => {
    expect(contrast("#777777", "#888888")).toBeLessThan(1.5);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});
