import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A form that is handled by JavaScript must still say method="post": if the page's script has not loaded when someone presses the button, the browser would otherwise
// send the fields in the address (GET), putting a password or a phone number into the URL, the history and the server logs. (Found by the ZAP baseline scan, 2026-10-21.)
const ROOT = join(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === ".next") return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
  });

describe("forms handled in the browser never fall back to GET", () => {
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
  it("every <form onSubmit> declares method=\"post\"", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<form\b/g)) {
        // `onSubmit={...}` may contain `>` (arrow functions); take the opening tag by balancing braces instead.
        const start = m.index!;
        let depth = 0, end = start;
        for (let i = start; i < src.length; i++) {
          const c = src[i];
          if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === ">" && depth === 0) { end = i; break; }
        }
        const tag = src.slice(start, end + 1);
        if (/onSubmit=/.test(tag) && !/\bmethod="post"/.test(tag) && !/\baction=/.test(tag)) bad.push(f.slice(ROOT.length + 1));
      }
    }
    expect(bad).toEqual([]);
  });
});
