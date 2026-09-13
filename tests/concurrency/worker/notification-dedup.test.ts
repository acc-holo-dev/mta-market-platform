// PLAN-020 E-002/E-002b: notification dedupKey — DB-level idempotency.
//
// Invariants:
//  - the SAME dedupKey can never produce two rows, no matter how many
//    concurrent delivery paths call createNotifications (admin route, outbox
//    worker dispatch, CRON sweep all race the same (recipient, version));
//  - different dedupKeys / NULL dedupKey rows are unaffected;
//  - a unique-violation skip is benign (not an error path).
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { db } from "@server/prisma/db";
import { createNotifications } from "@server/lib/notify";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const USER_ID = "550e8400-e29b-41d4-a716-44665544c101";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[notification-dedup.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await createTestUser(USER_ID, `ccy-notif_${SUFFIX}`, "USER", () => "unused");
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("notification dedupKey (PLAN-020 E-002)", () => {
  it("a concurrent duplicate dedupKey creates exactly one notification", async () => {
    const versionId = `11111111-2222-3333-4444-55555555${SUFFIX}`;
    const dedupKey = `RESOURCE_UPDATE:resourceVersion:${versionId}:${USER_ID}`;
    const draft = {
      recipientId: USER_ID,
      type: "RESOURCE_UPDATE" as const,
      title: "t — новая версия v1",
      entityType: "resourceVersion",
      entityId: versionId,
      dedupKey,
    };

    // Simulate the admin route + worker dispatch + CRON sweep racing.
    const results = await Promise.all([
      createNotifications([draft]),
      createNotifications([{ ...draft, title: "duplicate path" }]),
      createNotifications([{ ...draft, title: "third path" }]),
    ]);

    // Exactly one path wins; the rest are benign skips.
    expect(results.filter((n) => n === 1).length).toBe(1);
    const rows = await db.orm.public.Notification
      .where({ recipientId: USER_ID, entityType: "resourceVersion", entityId: versionId })
      .all();
    expect(rows.length).toBe(1);
    expect((rows[0] as unknown as { dedupKey: string }).dedupKey).toBe(dedupKey);
  });

  it("rows without a dedupKey are never deduplicated", async () => {
    // Separate calls: createNotifications dedups per recipient within ONE
    // call (PLAN-005 M), but rows without a dedupKey must never be blocked
    // by the unique index across calls or paths.
    await createNotifications([{ recipientId: USER_ID, type: "FORUM_REPLY", title: "a" }]);
    await createNotifications([{ recipientId: USER_ID, type: "FORUM_REPLY", title: "b" }]);
    const rows = await db.orm.public.Notification
      .where({ recipientId: USER_ID, type: "FORUM_REPLY" })
      .all();
    expect(rows.length).toBe(2);
  });
});