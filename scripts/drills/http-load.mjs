#!/usr/bin/env node
// Small HTTP load check for the public customer path (release check 13). Not a stress test: it asks "does a realistic burst of visitors get fast, correct answers?"
//   BASE=http://127.0.0.1:3100 SLUG=<published business> node scripts/drills/http-load.mjs [seconds=20] [concurrency=20]
// Each request carries its own X-Forwarded-For so the per-address limiter sees many visitors (as it would in real life), not one address hammering.
// Run against a local copy or a test environment, never against a production system that has real customers.
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const SLUG = process.env.SLUG;
if (!SLUG) throw new Error("SLUG is required");
const seconds = Number(process.argv[2] ?? 20), concurrency = Number(process.argv[3] ?? 20);
const ip = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const today = new Date().toISOString().slice(0, 10);
const catalog = await (await fetch(`${BASE}/api/public/${SLUG}/services`, { headers: { "x-forwarded-for": ip() } })).json();
const service = catalog.services?.[0]?.id;
if (!service) throw new Error("the business has no service to book");
const paths = [`/book/${SLUG}`, `/api/public/${SLUG}/services`, `/api/public/${SLUG}/availability?service=${service}&from=${today}&days=14`, `/auth/login`];
const stats = new Map(paths.map((p) => [p, { ms: [], status: new Map() }]));
const until = Date.now() + seconds * 1000;
async function worker(n) {
  for (let i = n; Date.now() < until; i++) {
    const path = paths[i % paths.length];
    const t0 = performance.now();
    let status = "ERR";
    try {
      const res = await fetch(BASE + path, { headers: { "x-forwarded-for": ip() }, signal: AbortSignal.timeout(15000) });
      await res.arrayBuffer();
      status = String(res.status);
    } catch {}
    const s = stats.get(path);
    s.ms.push(performance.now() - t0);
    s.status.set(status, (s.status.get(status) ?? 0) + 1);
  }
}
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
let total = 0, bad = 0;
console.log(`${seconds}s, ${concurrency} concurrent, ${BASE}`);
for (const [path, s] of stats) {
  const n = s.ms.length; total += n;
  const codes = [...s.status].map(([c, k]) => `${c}x${k}`).join(" ");
  // only 5xx answers and network errors count as failures
  for (const [c, k] of s.status) if (c === "ERR" || c.startsWith("5")) bad += k;
  console.log(`${path.slice(0, 60).padEnd(62)} n=${String(n).padStart(5)}  p50=${q(s.ms, 0.5).toFixed(0)}ms  p95=${q(s.ms, 0.95).toFixed(0)}ms  p99=${q(s.ms, 0.99).toFixed(0)}ms  ${codes}`);
}
console.log(`requests=${total}  rps=${(total / seconds).toFixed(0)}  server-errors=${bad}`);
process.exit(bad === 0 ? 0 : 1);
