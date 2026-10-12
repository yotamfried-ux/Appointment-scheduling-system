import "server-only";
import { systemDb } from "@/platform/system-db";

/** Can this instance reach its database right now? One cheap read with a short timeout; never throws, never says why it failed. */
export async function databaseReady(timeoutMs = 2000): Promise<boolean> {
  try {
    const { error } = await systemDb().from("plans").select("id").limit(1).abortSignal(AbortSignal.timeout(timeoutMs));
    return !error;
  } catch {
    return false;
  }
}
