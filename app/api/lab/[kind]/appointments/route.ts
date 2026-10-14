import { api, sessionOf } from "@/lib/api/http";
import { kindOf } from "@/lib/api/route-helpers";
import { appointmentsFor } from "@/lib/api/lab-store";

export const GET = api<{ kind: string }>(async (req, { kind }) => appointmentsFor(sessionOf(req), kindOf(kind)));
