import { AsyncLocalStorage } from "node:async_hooks";

// Every call to the database or the auth server gets a deadline. Without one a frozen database turns every page and every API call into an endless spinner (OPS-03).
// When a deadline passes (or the connection is refused) the request is marked, so the API layer can answer 503 "try again" instead of a misleading 500 or a hang.
export const DB_TIMEOUT_MS = Number(process.env.DB_TIMEOUT_MS) || 8000;

type Scope = { unavailable: boolean; calls: number; ms: number };
const requestScope = new AsyncLocalStorage<Scope>();

export const runInDbScope = <T>(fn: () => Promise<T>) => requestScope.run({ unavailable: false, calls: 0, ms: 0 }, fn);
/** How many calls this request made to the database/auth server and how long it waited for them in total (for the Server-Timing header). */
export const dbTiming = () => {
  const s = requestScope.getStore();
  return s ? { calls: s.calls, ms: s.ms } : null;
};
export const dbWasUnavailable = () => requestScope.getStore()?.unavailable === true;

export class DbUnavailableError extends Error {
  code = "DB_UNAVAILABLE";
  constructor() {
    super("database unavailable");
    this.name = "DbUnavailableError";
  }
}

/** `fetch` with a deadline that still honours a caller's own abort signal. */
export function timeoutFetch(ms = DB_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const deadline = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    const started = performance.now();
    const store0 = requestScope.getStore();
    try {
      return await fetch(input, { ...init, signal });
    } catch (e) {
      if (init?.signal?.aborted) throw e; // the caller gave up on purpose: not an outage
      const store = requestScope.getStore();
      if (store) store.unavailable = true;
      throw new DbUnavailableError();
    } finally {
      if (store0) {
        store0.calls += 1;
        store0.ms += performance.now() - started; // overlapping calls add up: parallel reads show their summed wait, not the wall time
      }
    }
  };
}
