import { api, parse, readJson, sessionOf } from "@/lib/api/http";
import { TransitionRequest } from "@/lib/api/contracts";
import { kindOf } from "@/lib/api/route-helpers";
import { transitionAppointment } from "@/lib/api/lab-store";

export const POST = api<{ kind: string; id: string }>(async (req, { kind, id }) => {
  const { action } = parse(TransitionRequest, await readJson(req));
  return transitionAppointment(sessionOf(req), kindOf(kind), id, action);
});
