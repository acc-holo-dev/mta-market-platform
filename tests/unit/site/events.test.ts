// PLAN-019 H-001/H-002 unit tests (pure — no database): the canonical event
// union, event-name validation on emit, payload passthrough (captured with a
// fake executor — no DB connection is made), and the retry backoff table
// that backs the H-005 dead-letter policy.
import { describe, it, expect } from "vitest";
import {
  OUTBOX_EVENT_TYPES,
  isKnownOutboxEventType,
  assertKnownOutboxEventType,
  emitOutbox,
  outboxBackoffMs,
  DEFAULT_MAX_ATTEMPTS,
} from "@server/lib/events";

/**
 * Minimal executor shaped like `db` / a db.transaction() handle: only the
 * OutboxEvent.create lane events.ts touches, recording the insert payload.
 * Keeps the suite pure (no DATABASE_URL needed).
 */
function fakeExecutor() {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    orm: {
      public: {
        OutboxEvent: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: async (data: any) => {
            created.push(data);
            return { id: `evt-${created.length}`, ...data };
          },
        },
      },
    },
  };
}

describe("canonical outbox event types", () => {
  it("exposes exactly the eleven canonical event names", () => {
    expect([...OUTBOX_EVENT_TYPES]).toEqual([
      "USER_REGISTERED",
      "RESOURCE_PUBLISHED",
      "RESOURCE_VERSION_PUBLISHED",
      "PAYMENT_SUCCEEDED",
      "PAYMENT_FAILED",
      "REFUND_COMPLETED",
      "PAYOUT_COMPLETED",
      "DISPUTE_OPENED",
      "DISPUTE_UPDATED",
      "LICENSE_EXPIRING",
      "SECURITY_ALERT",
    ]);
  });

  it("recognizes every canonical name and rejects junk", () => {
    for (const name of OUTBOX_EVENT_TYPES) {
      expect(isKnownOutboxEventType(name)).toBe(true);
    }
    expect(isKnownOutboxEventType("NOT_A_EVENT")).toBe(false);
    expect(isKnownOutboxEventType("payment_succeeded")).toBe(false); // case-sensitive
    expect(isKnownOutboxEventType("")).toBe(false);
  });

  it("assertKnownOutboxEventType throws for unknown names", () => {
    expect(() => assertKnownOutboxEventType("NOT_A_EVENT")).toThrow(/unknown event type/i);
    expect(() => assertKnownOutboxEventType("")).toThrow(/unknown event type/i);
    expect(() => assertKnownOutboxEventType("PAYMENT_SUCCEEDED")).not.toThrow();
  });
});

describe("emitOutbox (pure, fake executor)", () => {
  it("inserts a PENDING row with the exact event type and payload", async () => {
    const fake = fakeExecutor();
    const payload = { purchaseId: "p1", resourceId: "r1", buyerId: "u1" };
    const result = await emitOutbox(fake, "PAYMENT_SUCCEEDED", payload);

    expect(result.id).toBe("evt-1");
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toEqual({
      eventType: "PAYMENT_SUCCEEDED",
      payload,
      status: "PENDING",
    });
  });

  it("passes the payload through unchanged (roundtrip, incl. nested values)", async () => {
    const fake = fakeExecutor();
    const payload = {
      resourceId: "r2",
      nested: { ids: ["a", "b"], amountMinor: 4200, flag: true, none: null },
    };
    await emitOutbox(fake, "RESOURCE_PUBLISHED", payload);

    expect(fake.created[0]?.payload).toEqual(payload);
    // The event name survives verbatim (the worker dispatches on it).
    expect(fake.created[0]?.eventType).toBe("RESOURCE_PUBLISHED");
    expect(fake.created[0]?.status).toBe("PENDING");
  });

  it("rejects unknown event names before touching the executor", async () => {
    const fake = fakeExecutor();
    await expect(
      emitOutbox(fake, "PAYMENT_SUCCEEDEDD" as never, {})
    ).rejects.toThrow(/unknown event type/i);
    await expect(emitOutbox(fake, "" as never, {})).rejects.toThrow(/unknown event type/i);
    expect(fake.created).toHaveLength(0);
  });
});

describe("H-005 retry backoff", () => {
  it("follows the 2^attempts * 30s table", () => {
    expect(outboxBackoffMs(1)).toBe(60_000);
    expect(outboxBackoffMs(2)).toBe(120_000);
    expect(outboxBackoffMs(3)).toBe(240_000);
    expect(outboxBackoffMs(4)).toBe(480_000);
    expect(outboxBackoffMs(5)).toBe(960_000);
  });

  it("clamps nonsensical attempt counts into a sane range", () => {
    expect(outboxBackoffMs(0)).toBe(60_000); // floor at one retry step
    expect(outboxBackoffMs(-3)).toBe(60_000);
    expect(outboxBackoffMs(100)).toBe(2 ** 20 * 30_000); // ceiling
    expect(Number.isFinite(outboxBackoffMs(100))).toBe(true);
  });

  it("caps retries at 5 attempts by default", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
  });
});