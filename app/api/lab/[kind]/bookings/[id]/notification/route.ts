import { api, sessionOf } from "@/lib/api/http";
import { kindOf } from "@/lib/api/route-helpers";
import { notificationFor } from "@/lib/api/lab-store";

export const GET = api<{ kind: string; id: string }>(async (req, { kind, id }) => notificationFor(sessionOf(req), kindOf(kind), id));
