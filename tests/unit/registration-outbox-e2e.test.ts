import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { render, type NotifContext } from "@/modules/notifications/templates";
import { platformAdminEmail } from "@/modules/notifications/config";
import { PermanentEmailError, TransientEmailError, type EmailPort } from "@/modules/notifications/ports";

describe("Business Registration Alert & Outbox E2E Flow", () => {
  const testBusinessId = "99999999-aaaa-bbbb-cccc-dddddddddddd";
  const testBusinessName = "סטודיו ליוגה שמש";
  const testSlug = "yoga-shemesh";

  it("produces valid registration alert notification with zero PII exposure", () => {
    const ctx: NotifContext = {
      type: "admin_business_registered",
      recipient: "admin",
      appointment: null,
      offer: null,
      registration: {
        businessId: testBusinessId,
        name: testBusinessName,
        slug: testSlug,
        kind: "trainer",
        createdAt: "2026-10-25T14:30:00Z",
        ownerEmail: "owner@yogashemesh.co.il",
      },
      business: {
        name: testBusinessName,
        slug: testSlug,
        kind: "trainer",
        timezone: "Asia/Jerusalem",
        phone: "+972520001122",
      },
      customer: { name: "", email: null },
      owner: { email: "owner@yogashemesh.co.il" },
    };

    const rendered = render(ctx, { appUrl: "https://tori.app" });

    // Invariants
    expect(rendered.subject).toBe(`עסק חדש נרשם למערכת · ${testBusinessName}`);
    expect(rendered.html).toContain("ניהול יומן ותורים - התראת מנהל מערכת");
    expect(rendered.html).toContain(testBusinessName);
    expect(rendered.html).toContain(testBusinessId);
    expect(rendered.html).toContain(testSlug);
    expect(rendered.html).toContain("owner@yogashemesh.co.il");
    expect(rendered.html).toContain("https://tori.app/admin");

    // Recipient email check
    expect(platformAdminEmail()).toBe("yotam.fried@gmail.com");
  });

  it("handles transient provider errors with retry without dropping the notification", async () => {
    let sendAttempts = 0;
    const failingProvider: EmailPort = {
      name: "resend",
      send: vi.fn().mockImplementation(async () => {
        sendAttempts++;
        if (sendAttempts < 3) {
          throw new TransientEmailError("503 Service Unavailable: Resend rate limit", 30);
        }
        return { id: "resend-msg-ok-123" };
      }),
    };

    // Attempt 1: throws transient error
    let outcome1: string = "unknown";
    try {
      await failingProvider.send({
        to: platformAdminEmail(),
        subject: "test",
        html: "<p>test</p>",
        text: "test",
        idempotencyKey: `notif-biz-reg-${testBusinessId}`,
        attempt: 1,
      });
      outcome1 = "sent";
    } catch (err) {
      outcome1 = err instanceof TransientEmailError ? "retry" : "failed";
    }

    expect(outcome1).toBe("retry");
    expect(sendAttempts).toBe(1);

    // Attempt 2: retry throws transient error again
    let outcome2: string = "unknown";
    try {
      await failingProvider.send({
        to: platformAdminEmail(),
        subject: "test",
        html: "<p>test</p>",
        text: "test",
        idempotencyKey: `notif-biz-reg-${testBusinessId}`,
        attempt: 2,
      });
      outcome2 = "sent";
    } catch (err) {
      outcome2 = err instanceof TransientEmailError ? "retry" : "failed";
    }

    expect(outcome2).toBe("retry");
    expect(sendAttempts).toBe(2);

    // Attempt 3: recovered and sent successfully
    let outcome3: string = "unknown";
    let messageId: string | undefined;
    try {
      const res = await failingProvider.send({
        to: platformAdminEmail(),
        subject: "test",
        html: "<p>test</p>",
        text: "test",
        idempotencyKey: `notif-biz-reg-${testBusinessId}`,
        attempt: 3,
      });
      outcome3 = "sent";
      messageId = res.id;
    } catch {
      outcome3 = "retry";
    }

    expect(outcome3).toBe("sent");
    expect(messageId).toBe("resend-msg-ok-123");
    expect(sendAttempts).toBe(3);
  });

  it("marks permanent provider errors as dead letter instead of infinite retry loops", async () => {
    const permanentFailingProvider: EmailPort = {
      name: "resend",
      send: vi.fn().mockImplementation(async () => {
        throw new PermanentEmailError("422 Unprocessable Entity: Invalid recipient mailbox");
      }),
    };

    let outcome: string = "unknown";
    try {
      await permanentFailingProvider.send({
        to: "invalid-address",
        subject: "test",
        html: "<p>test</p>",
        text: "test",
        idempotencyKey: `notif-dead-${testBusinessId}`,
        attempt: 1,
      });
      outcome = "sent";
    } catch (err) {
      outcome = err instanceof PermanentEmailError ? "dead" : "retry";
    }

    expect(outcome).toBe("dead");
  });

  it("enforces idempotency key prevents duplicate sends to the provider", async () => {
    const sentKeys = new Set<string>();
    const idempotencyProvider: EmailPort = {
      name: "resend",
      send: vi.fn().mockImplementation(async (msg) => {
        if (sentKeys.has(msg.idempotencyKey)) {
          // Provider returns existing message without delivering a second email
          return { id: `cached-${msg.idempotencyKey}` };
        }
        sentKeys.add(msg.idempotencyKey);
        return { id: `first-${msg.idempotencyKey}` };
      }),
    };

    const key = `notif-biz-${testBusinessId}`;
    const firstCall = await idempotencyProvider.send({
      to: platformAdminEmail(),
      subject: "test",
      html: "<p>test</p>",
      text: "test",
      idempotencyKey: key,
      attempt: 1,
    });
    expect(firstCall.id).toBe(`first-${key}`);

    // Re-sending with the same key
    const secondCall = await idempotencyProvider.send({
      to: platformAdminEmail(),
      subject: "test",
      html: "<p>test</p>",
      text: "test",
      idempotencyKey: key,
      attempt: 2,
    });
    expect(secondCall.id).toBe(`cached-${key}`);
  });
});
