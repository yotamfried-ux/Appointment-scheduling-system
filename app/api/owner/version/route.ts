import { api } from "@/lib/api/http";
import { changeVersion, ownerContext } from "@/modules/booking/owner/service";

// Polled by the dashboard while the tab is visible: a few indexed reads, no payload to speak of.
export const GET = api(async () => ({ version: await changeVersion(await ownerContext()) }), { lab: false });
