// Applies supabase/migrations to ONE Supabase project through the Management API (token only, no database password).
// Used by .github/workflows/db-push-test.yml (method "api"). Usage: SUPABASE_ACCESS_TOKEN=... node scripts/apply-migrations-api.mjs <project-ref>
// Each file runs in one request together with the insert of its history row, so a failing file leaves nothing behind. Files already in
// supabase_migrations.schema_migrations are skipped, so it is safe to run again.
import { readdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ref = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!/^[a-z]{20}$/.test(ref ?? "") || !token) {
  console.error("usage: SUPABASE_ACCESS_TOKEN=... node scripts/apply-migrations-api.mjs <project-ref>");
  process.exit(2);
}

async function q(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : [];
}

await q(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
const applied = new Set((await q("select version from supabase_migrations.schema_migrations")).map((r) => r.version));

// The first migration was applied by hand once, under the version number the tool gave it. Record it under the repository's version.
if (applied.has("20261013073942")) {
  await q(`delete from supabase_migrations.schema_migrations where version = '20261013073942' and name = 'foundation';
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261011000000', 'foundation', array['applied by hand']) on conflict do nothing`);
  applied.delete("20261013073942");
  applied.add("20261011000000");
  console.log("history reconciled: foundation recorded as 20261011000000");
}

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
  const name = rest.join("_");
  if (applied.has(version)) { console.log(`skip   ${f}`); continue; }
  const sql = readFileSync(new URL(f, dir), "utf8");
  const tag = `$m${randomBytes(6).toString("hex")}$`;
  if (sql.includes(tag)) throw new Error(`unlucky dollar tag in ${f}`);
  await q(`${sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${name}', array[${tag}${sql}${tag}])`);
  console.log(`apply  ${f}`);
}

const [{ n: migrations }] = await q("select count(*)::int as n from supabase_migrations.schema_migrations");
const lint = await q("select rule, object_name from private.lint_violations()");
console.log(`migrations recorded: ${migrations} of ${files.length}`);
console.log(`private.lint_violations(): ${lint.length} row(s)`);
if (lint.length) { console.log(JSON.stringify(lint)); process.exit(1); }
