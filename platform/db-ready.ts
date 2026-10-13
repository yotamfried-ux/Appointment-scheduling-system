import "server-only";
import { classifyDbFailure } from "@/platform/db-failure";
import { systemDb } from "@/platform/system-db";

/** Can this instance reach its database right now? One cheap read with a short timeout; never throws, never says why to the caller (the reason is a fixed word in the server log). */
export async function databaseReady(timeoutMs = 2000): Promise<boolean> {
  try {
    const { error } = await systemDb().from("plans").select("id").limit(1).abortSignal(AbortSignal.timeout(timeoutMs));
    if (error) console.error(JSON.stringify({ event: "db_not_ready", reason: classifyDbFailure(error) }));
    return !error;
  } catch (e) {
    console.error(JSON.stringify({ event: "db_not_ready", reason: classifyDbFailure(e) }));
    return false;
  }
}
