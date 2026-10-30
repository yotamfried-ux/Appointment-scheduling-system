#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const targetDir = process.argv[2] || "codeql-results";
const resultsDir = path.resolve(targetDir);

if (!fs.existsSync(resultsDir)) {
  console.error(`FATAL: CodeQL results directory does not exist: ${resultsDir}`);
  process.exit(1);
}

const files = fs.readdirSync(resultsDir).filter((f) => f.endsWith(".sarif"));
if (files.length === 0) {
  console.error(`FATAL: No SARIF report files found in: ${resultsDir}`);
  process.exit(1);
}

let totalFindings = 0;
let criticalErrors = 0;

for (const file of files) {
  const filePath = path.join(resultsDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const runs = data.runs || [];

  if (runs.length === 0) {
    console.error(`FATAL: SARIF file contains no runs: ${file}`);
    process.exit(1);
  }

  for (const run of runs) {
    const rulesById = new Map();
    for (const rule of run.tool?.driver?.rules || []) {
      rulesById.set(rule.id, rule);
    }

    const results = run.results || [];
    totalFindings += results.length;

    for (const res of results) {
      const rule = rulesById.get(res.ruleId) || {};
      const secSeverity = parseFloat(rule.properties?.["security-severity"] || "0");
      const isError = res.level === "error" || secSeverity >= 7.0;

      if (isError) {
        console.error(
          `CRITICAL CodeQL finding: [${res.ruleId}] ${res.message?.text || ""} at ${
            res.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "unknown"
          }`
        );
        criticalErrors++;
      }
    }
  }
}

console.log(`CodeQL Gate: Scanned ${files.length} SARIF file(s) with ${totalFindings} total finding(s).`);

if (criticalErrors > 0) {
  console.error(`CodeQL Gate FAILED: ${criticalErrors} high/critical/error finding(s) detected.`);
  process.exit(1);
}

console.log("CodeQL Gate PASSED: 0 critical/error findings.");
