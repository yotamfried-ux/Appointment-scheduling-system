import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbUnavailableError, dbWasUnavailable, runInDbScope, timeoutFetch } from "@/platform/db-timeout";

// A server that accepts the connection and never answers: exactly what a frozen database looks like to the app (OPS-03).
let hang: Server;
let ok: Server;
let hangUrl = "";
let okUrl = "";
beforeAll(async () => {
  hang = createServer(() => undefined);
  ok = createServer((_req, res) => res.end("fine"));
  await Promise.all([new Promise<void>((r) => hang.listen(0, "127.0.0.1", r)), new Promise<void>((r) => ok.listen(0, "127.0.0.1", r))]);
  hangUrl = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;
  okUrl = `http://127.0.0.1:${(ok.address() as AddressInfo).port}`;
});
afterAll(() => {
  hang.closeAllConnections();
  hang.close();
  ok.close();
});

describe("database deadline (OPS-03)", () => {
  it("a server that never answers fails at the deadline instead of hanging, and marks the request as unavailable", async () => {
    const started = Date.now();
    await runInDbScope(async () => {
      await expect(timeoutFetch(300)(hangUrl)).rejects.toBeInstanceOf(DbUnavailableError);
      expect(dbWasUnavailable()).toBe(true);
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });
  it("a connection that is refused counts the same way", async () => {
    await runInDbScope(async () => {
      await expect(timeoutFetch(300)("http://127.0.0.1:1")).rejects.toBeInstanceOf(DbUnavailableError);
      expect(dbWasUnavailable()).toBe(true);
    });
  });
  it("a healthy server is untouched and the request is not marked", async () => {
    await runInDbScope(async () => {
      const r = await timeoutFetch(2000)(okUrl);
      expect(await r.text()).toBe("fine");
      expect(dbWasUnavailable()).toBe(false);
    });
  });
  it("the mark belongs to ONE request: another request in flight is not affected", async () => {
    const [a, b] = await Promise.all([
      runInDbScope(async () => { await timeoutFetch(200)(hangUrl).catch(() => undefined); return dbWasUnavailable(); }),
      runInDbScope(async () => { await timeoutFetch(2000)(okUrl); return dbWasUnavailable(); }),
    ]);
    expect([a, b]).toEqual([true, false]);
  });
  it("a caller that aborts on purpose is not reported as an outage", async () => {
    await runInDbScope(async () => {
      const c = new AbortController();
      const p = timeoutFetch(5000)(hangUrl, { signal: c.signal });
      setTimeout(() => c.abort(), 50);
      await expect(p).rejects.not.toBeInstanceOf(DbUnavailableError);
      expect(dbWasUnavailable()).toBe(false);
    });
  });
  it("outside a request scope it still times out (jobs, scripts) without needing one", async () => {
    await expect(timeoutFetch(200)(hangUrl)).rejects.toBeInstanceOf(DbUnavailableError);
    expect(dbWasUnavailable()).toBe(false);
  });
});
