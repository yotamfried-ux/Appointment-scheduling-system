import "server-only";
import { databaseReady } from "@/platform/db-ready";
import { jobHealth, type JobHealth } from "@/modules/notifications/job-health";
import { systemDb } from "@/platform/system-db";
import { emailProvider, platformAdminEmail } from "@/modules/notifications/config";
import type { EmailMessage } from "@/modules/notifications/ports";

export interface MonitorReport {
  healthy: boolean;
  timestamp: string;
  checks: {
    app: { status: "ok" };
    database: { status: "ready" | "unavailable"; latencyMs?: number };
    cron: { status: "healthy" | "unhealthy" | "unknown"; jobs?: JobHealth[] };
  };
  incident: {
    status: "healthy" | "triggered" | "ongoing" | "recovered";
    failingComponents: string[];
    alertSent: boolean;
    alertError?: string;
    reason?: string;
  };
}

export interface MonitorOptions {
  simulate?: "database" | "cron" | "none";
}

interface StoredIncidentState {
  isIncident: boolean;
  components: string[];
  firstDetectedAt?: string;
  lastAlertSentAt?: string;
  reason?: string;
  fromDb: boolean;
}

let transientFallbackState: {
  isIncident: boolean;
  components: string[];
  firstDetectedAt?: string;
  lastAlertSentAt?: string;
  reason?: string;
} = { isIncident: false, components: [] };

export function resetMonitorStateForTesting(): void {
  transientFallbackState = { isIncident: false, components: [] };
}

async function getStoredIncidentState(dbAvailable: boolean): Promise<StoredIncidentState> {
  if (!dbAvailable) {
    return { ...transientFallbackState, fromDb: false };
  }
  try {
    const { data, error } = await systemDb()
      .from("job_runs")
      .select("status, error, started_at, finished_at")
      .eq("job_name", "monitor")
      .eq("run_key", "incident_state")
      .maybeSingle();

    if (error || !data) {
      return { ...transientFallbackState, fromDb: true };
    }

    if (data.status === "failed") {
      try {
        const parsed = JSON.parse(data.error ?? "{}");
        const state = {
          isIncident: true,
          components: Array.isArray(parsed.components) ? parsed.components : ["unknown"],
          firstDetectedAt: parsed.firstDetectedAt ?? data.started_at,
          lastAlertSentAt: parsed.lastAlertSentAt ?? data.finished_at,
          reason: parsed.reason,
          fromDb: true,
        };
        transientFallbackState = { ...state };
        return state;
      } catch {
        const state = {
          isIncident: true,
          components: ["unknown"],
          firstDetectedAt: data.started_at,
          lastAlertSentAt: data.finished_at,
          reason: data.error ?? undefined,
          fromDb: true,
        };
        transientFallbackState = { ...state };
        return state;
      }
    }

    const state = { isIncident: false, components: [], fromDb: true };
    transientFallbackState = { ...state };
    return state;
  } catch {
    return { ...transientFallbackState, fromDb: false };
  }
}

async function persistIncidentState(state: {
  isIncident: boolean;
  components: string[];
  firstDetectedAt?: string;
  lastAlertSentAt?: string;
  reason?: string;
}): Promise<void> {
  transientFallbackState = { ...state };
  try {
    const isFailed = state.isIncident;
    const errorPayload = isFailed
      ? JSON.stringify({
          components: state.components,
          reason: state.reason,
          firstDetectedAt: state.firstDetectedAt,
          lastAlertSentAt: state.lastAlertSentAt,
        })
      : null;

    await systemDb()
      .from("job_runs")
      .upsert(
        {
          job_name: "monitor",
          run_key: "incident_state",
          status: isFailed ? "failed" : "succeeded",
          started_at: state.firstDetectedAt ?? new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error: errorPayload,
        },
        { onConflict: "job_name,run_key" }
      );
  } catch (e) {
    console.error("Failed to persist monitor incident state:", e);
  }
}

async function sendAlertEmail(components: string[], reason: string, timestamp: string): Promise<void> {
  const provider = emailProvider();
  const recipient = platformAdminEmail();
  const componentList = components.join(", ");
  const subject = `[ALERT] Tori Production Monitor Incident — ${componentList}`;
  const logsUrl = "https://vercel.com/yotamfried-ux/appointment-scheduling-system/logs";

  const text = [
    `CRITICAL ALERT: Production Health & SLA Violation`,
    `System: Tori`,
    `Environment: Production (turim.d2ryf.com)`,
    `Failing Component(s): ${componentList}`,
    `Detected At: ${timestamp} UTC`,
    `Reason: ${reason}`,
    `Severity: High`,
    `Vercel Logs: ${logsUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ef4444; border-radius: 8px;">
      <h2 style="color: #dc2626; margin-top: 0;">⚠️ Tori Production Monitor Alert</h2>
      <p>A production health check or cron SLA violation has been detected.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">System</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Tori</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Environment</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Production (turim.d2ryf.com)</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Failing Component(s)</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: bold;">${componentList}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Detected At (UTC)</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${timestamp}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Severity</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #dc2626;">High</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Details</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${reason}</td></tr>
      </table>
      <p><a href="${logsUrl}" style="background-color: #dc2626; color: white; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">View Vercel Runtime Logs</a></p>
    </div>
  `;

  const message: EmailMessage = {
    to: recipient,
    subject,
    text,
    html,
    idempotencyKey: `tori-alert-${components.sort().join("-")}-${new Date().toISOString().slice(0, 13)}`,
    attempt: 1,
  };

  await provider.send(message);
}

async function sendRecoveryEmail(timestamp: string): Promise<void> {
  const provider = emailProvider();
  const recipient = platformAdminEmail();
  const subject = `[RESOLVED] Tori Production Monitor — All systems operational`;
  const logsUrl = "https://vercel.com/yotamfried-ux/appointment-scheduling-system/logs";

  const text = [
    `RECOVERY NOTICE: Production Systems Operational`,
    `System: Tori`,
    `Environment: Production (turim.d2ryf.com)`,
    `Status: RECOVERED`,
    `All probes passing: Next.js Liveness, Supabase Database Readiness, 4/4 Vercel Cron Jobs SLA.`,
    `Recovered At: ${timestamp} UTC`,
    `Vercel Logs: ${logsUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #10b981; border-radius: 8px;">
      <h2 style="color: #059669; margin-top: 0;">✅ Tori Production Systems Recovered</h2>
      <p>All automated production health probes and cron SLA checks have returned to normal operating status.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">System</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Tori</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Environment</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Production (turim.d2ryf.com)</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Status</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #059669; font-weight: bold;">Operational (100% Green)</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Recovered At (UTC)</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${timestamp}</td></tr>
      </table>
      <p><a href="${logsUrl}" style="background-color: #059669; color: white; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">View Vercel Runtime Logs</a></p>
    </div>
  `;

  const message: EmailMessage = {
    to: recipient,
    subject,
    text,
    html,
    idempotencyKey: `tori-recovered-${new Date().toISOString().slice(0, 16)}`,
    attempt: 1,
  };

  await provider.send(message);
}

export async function runProductionMonitor(options: MonitorOptions = {}): Promise<MonitorReport> {
  const timestamp = new Date().toISOString();
  const failingComponents: string[] = [];
  const failureReasons: string[] = [];

  // 1. Application Liveness
  const appStatus = { status: "ok" as const };

  // 2. Database Readiness
  const dbStart = Date.now();
  let dbOk = false;
  if (options.simulate === "database") {
    dbOk = false;
  } else {
    try {
      dbOk = await databaseReady(2500);
    } catch {
      dbOk = false;
    }
  }
  const dbLatencyMs = Date.now() - dbStart;

  if (!dbOk) {
    failingComponents.push("database");
    failureReasons.push(options.simulate === "database" ? "Simulated database probe failure" : "Supabase database unreachable or query timed out");
  }

  // 3. Cron Jobs SLA Health
  let cronStatus: "healthy" | "unhealthy" | "unknown" = "unknown";
  let cronJobs: JobHealth[] | undefined;

  if (options.simulate === "cron") {
    cronStatus = "unhealthy";
    cronJobs = [
      { job: "outbox", lastOk: new Date(Date.now() - 3600_000).toISOString(), ageMinutes: 60, failed24h: 3, stale: true },
      { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
      { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 2, failed24h: 0, stale: false },
      { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 120, failed24h: 0, stale: false },
    ];
    failingComponents.push("cron:outbox");
    failureReasons.push("Simulated stale cron job: outbox (age: 60m)");
  } else if (dbOk) {
    try {
      const health = await jobHealth();
      cronJobs = health.jobs;
      if (health.ok) {
        cronStatus = "healthy";
      } else {
        cronStatus = "unhealthy";
        const staleJobs = health.jobs.filter((j) => j.stale);
        for (const sj of staleJobs) {
          failingComponents.push(`cron:${sj.job}`);
          failureReasons.push(`Stale job: ${sj.job} (last success: ${sj.lastOk ?? "never"}, age: ${sj.ageMinutes ?? "unknown"}m, failed24h: ${sj.failed24h})`);
        }
      }
    } catch (e) {
      cronStatus = "unhealthy";
      failingComponents.push("cron:job_status");
      failureReasons.push(`Unable to query job_status RPC: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  const isHealthy = failingComponents.length === 0;

  // 4. Incident State & Deduplication Processing
  let incidentStatus: "healthy" | "triggered" | "ongoing" | "recovered" = "healthy";
  let alertSent = false;
  let alertError: string | undefined;

  const prevState = await getStoredIncidentState(dbOk);

  if (!isHealthy) {
    // Current run is in a failure state
    const sortedCurrent = [...failingComponents].sort();
    const sortedPrev = [...prevState.components].sort();
    const isSameComponents = prevState.isIncident && sortedCurrent.join(",") === sortedPrev.join(",");

    if (!prevState.isIncident || !isSameComponents) {
      // New incident OR failing components have materially changed
      incidentStatus = "triggered";
      try {
        await sendAlertEmail(failingComponents, failureReasons.join("; "), timestamp);
        alertSent = true;
      } catch (err) {
        alertSent = false;
        alertError = err instanceof Error ? err.message : String(err);
        console.error("Monitor alert email delivery failed:", err);
      }

      await persistIncidentState({
        isIncident: true,
        components: failingComponents,
        firstDetectedAt: prevState.firstDetectedAt ?? timestamp,
        lastAlertSentAt: timestamp,
        reason: failureReasons.join("; "),
      });
    } else {
      // Incident is ongoing and components have not changed -> DEDUPLICATE (no duplicate email)
      incidentStatus = "ongoing";
      alertSent = false;
    }
  } else {
    // Current run is healthy
    if (prevState.isIncident) {
      // System recovered from previous incident!
      incidentStatus = "recovered";
      try {
        await sendRecoveryEmail(timestamp);
        alertSent = true;
      } catch (err) {
        alertSent = false;
        alertError = err instanceof Error ? err.message : String(err);
        console.error("Monitor recovery email delivery failed:", err);
      }

      await persistIncidentState({
        isIncident: false,
        components: [],
      });
    } else {
      incidentStatus = "healthy";
      alertSent = false;
    }

    // Record regular heartbeat row in job_runs if DB is available
    if (dbOk) {
      const bucketKey = `m:${timestamp.slice(0, 16)}`;
      try {
        await systemDb().rpc("job_begin", { p_job: "monitor", p_key: bucketKey });
        await systemDb().rpc("job_finish", { p_job: "monitor", p_key: bucketKey, p_error: null });
      } catch (e) {
        // Heartbeat logging failure is non-fatal
        console.error("Monitor heartbeat recording error:", e);
      }
    }
  }

  return {
    healthy: isHealthy,
    timestamp,
    checks: {
      app: appStatus,
      database: { status: dbOk ? "ready" : "unavailable", latencyMs: dbLatencyMs },
      cron: { status: cronStatus, jobs: cronJobs },
    },
    incident: {
      status: incidentStatus,
      failingComponents,
      alertSent,
      alertError,
      reason: failureReasons.length > 0 ? failureReasons.join("; ") : undefined,
    },
  };
}
