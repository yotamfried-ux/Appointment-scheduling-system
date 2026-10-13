import "server-only";
import { classifyDbFailure } from "@/platform/db-failure";
import { missingPublicConfig, missingServerConfig } from "@/platform/public-config";
import { systemDb } from "@/platform/system-db";

/** Can this instance reach its database right now? One cheap read with a short timeout; never throws, never says why to the caller (the reason is a fixed word in the server log). */
export async function databaseReady(timeoutMs = 2000): Promise<boolean> {
  // Compiled-in values: read with the literal names so the bundler inlines them exactly as it does for the pages.
  const missing = [
    ...missingPublicConfig({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }),
    ...missingServerConfig({ bookingTokenSecret: process.env.BOOKING_TOKEN_SECRET }), // a deployment that cannot sign a booking is not ready: it answered "ready" while every booking failed
  ];
  if (missing.length > 0) {
    console.error(JSON.stringify({ event: "public_config_missing", variables: missing }));
    return false;
  }
  try {
    const { error } = await systemDb().from("plans").select("id").limit(1).abortSignal(AbortSignal.timeout(timeoutMs));
    if (error) console.error(JSON.stringify({ event: "db_not_ready", reason: classifyDbFailure(error) }));
    return !error;
  } catch (e) {
    console.error(JSON.stringify({ event: "db_not_ready", reason: classifyDbFailure(e) }));
    return false;
  }
}
