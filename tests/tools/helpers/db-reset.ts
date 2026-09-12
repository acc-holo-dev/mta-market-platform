// Shared test-DB reset: removes all entities belonging to the fixed test
// user ID range (550e8400-e29b-41d4-a716-44665544xx) in FK-safe order.
// Robust across failed runs — every step is independent and idempotent.
import { db } from "@server/prisma/db";

const TEST_ID_PREFIX = "550e8400-e29b-41d4-a716-44665544";

export async function resetTestEntities(): Promise<void> {
  const allUsers = await db.orm.public.User.where({}).all();
  const testUserIds = new Set(
    allUsers.filter((u) => u.id.startsWith(TEST_ID_PREFIX)).map((u) => u.id)
  );
  await deleteEntitiesForUserIds(testUserIds);
}

/**
 * PLAN-016 D-013: cleanup for users created through the API by test files
 * (plan001 registers `p1user_*`/`p1buyer_*`/… with random UUIDs — outside the
 * fixed test range). Same FK-safe order as the fixed-range reset.
 */
export async function resetUsersByUsernamePrefix(usernamePrefix: string): Promise<void> {
  const allUsers = await db.orm.public.User.where({}).all();
  const matched = new Set(
    allUsers.filter((u) => (u.username ?? "").startsWith(usernamePrefix)).map((u) => u.id)
  );
  await deleteEntitiesForUserIds(matched);
}

/** FK-safe entity deletion for an arbitrary set of user ids. */
async function deleteEntitiesForUserIds(testUserIds: Set<string>): Promise<void> {

  // 1. Purchases (cascade: license -> installation -> lease)
  try {
    const purchases = await db.orm.public.Purchase.where({}).all();
    for (const p of purchases) {
      if (testUserIds.has(p.buyerId)) {
        await db.orm.public.Purchase.where({ id: p.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] purchases:", e instanceof Error ? e.message : e);
  }

  // 2. Resources by test sellers (cascade: versions -> signatures/sandbox runs)
  try {
    const resources = await db.orm.public.Resource.where({}).all();
    for (const r of resources) {
      if (testUserIds.has(r.sellerId)) {
        await db.orm.public.Resource.where({ id: r.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] resources:", e instanceof Error ? e.message : e);
  }

  // 3. Publisher keys (FK restrict on user deletion)
  try {
    const keys = await db.orm.public.PublisherKey.where({}).all();
    for (const k of keys) {
      if (testUserIds.has(k.sellerId)) {
        await db.orm.public.PublisherKey.where({ id: k.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] publisher keys:", e instanceof Error ? e.message : e);
  }

  // 4. Financial transactions + balances (FK restrict on user deletion)
  try {
    const tx = await db.orm.public.FinancialTransaction.where({}).all();
    for (const t of tx) {
      if (testUserIds.has(t.userId)) {
        await db.orm.public.FinancialTransaction.where({ id: t.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] transactions:", e instanceof Error ? e.message : e);
  }
  try {
    const balances = await db.orm.public.SellerBalance.where({}).all();
    for (const b of balances) {
      if (testUserIds.has(b.userId)) {
        await db.orm.public.SellerBalance.where({ userId: b.userId }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] balances:", e instanceof Error ? e.message : e);
  }

  // 5. Payment provider events of the test range — PLAN-016: ALL providers,
  // not a single hardcoded one.
  try {
    const events = await db.orm.public.PaymentProviderEvent.where({}).all();
    for (const ev of events) {
      // Test events reference test purchases which are already gone
      const stillThere = await db.orm.public.Purchase.where({ id: ev.objectId }).first().catch(() => null);
      if (!stillThere) {
        await db.orm.public.PaymentProviderEvent.where({ id: ev.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] provider events:", e instanceof Error ? e.message : e);
  }

  // 6. PLAN Block 4 commerce tables (FK-safe order before user deletion):
  //    usages/campaigns (Restrict to user), service orders, orders+items.
  try {
    const allCampaigns = await db.orm.public.DiscountCampaign.where({}).all();
    for (const c of allCampaigns) {
      if (testUserIds.has(c.sellerId)) {
        const usages = await db.orm.public.DiscountUsage.where({ campaignId: c.id }).all();
        for (const u of usages) {
          await db.orm.public.DiscountUsage.where({ id: u.id }).delete().catch(() => undefined);
        }
        await db.orm.public.DiscountCampaign.where({ id: c.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] discount campaigns:", e instanceof Error ? e.message : e);
  }
  try {
    const usageRows = await db.orm.public.DiscountUsage.where({}).all();
    for (const u of usageRows) {
      if (testUserIds.has(u.userId)) {
        await db.orm.public.DiscountUsage.where({ id: u.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] discount usages:", e instanceof Error ? e.message : e);
  }
  try {
    const sps = await db.orm.public.ServicePurchase.where({}).all();
    for (const sp of sps) {
      if (testUserIds.has(sp.buyerId)) {
        // messages/deliveries/revisions cascade with the purchase
        await db.orm.public.ServicePurchase.where({ id: sp.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] service purchases:", e instanceof Error ? e.message : e);
  }
  try {
    const services = await db.orm.public.Service.where({}).all();
    for (const s of services) {
      if (testUserIds.has(s.sellerId)) {
        const items = await db.orm.public.ServiceOrderItem.where({ serviceId: s.id }).all();
        for (const it of items) {
          await db.orm.public.ServiceOrderItem.where({ id: it.id }).delete().catch(() => undefined);
        }
        await db.orm.public.Service.where({ id: s.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] services:", e instanceof Error ? e.message : e);
  }
  try {
    const orders = await db.orm.public.Order.where({}).all();
    for (const o of orders) {
      if (testUserIds.has(o.buyerId)) {
        // OrderItems cascade with the order; Purchase.orderItemId is SetNull
        await db.orm.public.Order.where({ id: o.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] orders:", e instanceof Error ? e.message : e);
  }

  // PLAN Q-004: audit rows are append-only; test-range actor rows are removed.
  try {
    const audits = await db.orm.public.AuditLog.where({}).all();
    for (const a of audits) {
      if (a.actorId.startsWith(TEST_ID_PREFIX)) {
        await db.orm.public.AuditLog.where({ id: a.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] audit logs:", e instanceof Error ? e.message : e);
  }

  // PLAN-019 H: outbox events have no user FK — commerce suites emit
  // PAYMENT_SUCCEEDED rows during checkout tests; leaving them behind
  // pollutes the outbox lifecycle suite (claim ordering/counting).
  try {
    const outboxRows = await db.orm.public.OutboxEvent.where({}).all();
    for (const row of outboxRows) {
      await db.orm.public.OutboxEvent.where({ id: row.id }).delete().catch(() => undefined);
    }
  } catch (e) {
    console.warn("[reset] outbox events:", e instanceof Error ? e.message : e);
  }

  // PLAN-012 §5: stale idempotency records from interrupted runs must not
  // leak into later runs (a same-key replay would replay a dead response or
  // conflict). Keys are namespaced per test file, so all test keys carry the
  // fixed test UUID ranges or per-run suffixes; rows of test-range users are
  // removed, plus every expired record.
  try {
    const idem = await db.orm.public.IdempotencyRecord.where({}).all();
    for (const rec of idem) {
      const expired = rec.expiresAt ? new Date(rec.expiresAt) < new Date() : false;
      if (testUserIds.has(rec.userId ?? "") || expired) {
        await db.orm.public.IdempotencyRecord.where({ id: rec.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] idempotency records:", e instanceof Error ? e.message : e);
  }

  // PLAN-005 community/server tables — FK-safe order, children first.
  // Report: keep only test-reporter rows (global queue hygiene).
  try {
    const reports = await db.orm.public.Report.where({}).all();
    for (const r of reports) {
      if (r.reporterId.startsWith(TEST_ID_PREFIX)) {
        await db.orm.public.Report.where({ id: r.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] reports:", e instanceof Error ? e.message : e);
  }
  // Notifications of the test range (recipient deletion cascades anyway, but
  // the queue should not keep dead references).
  try {
    const notifs = await db.orm.public.Notification.where({}).all();
    for (const n of notifs) {
      if (n.recipientId.startsWith(TEST_ID_PREFIX)) {
        await db.orm.public.Notification.where({ id: n.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] notifications:", e instanceof Error ? e.message : e);
  }
  // Forum: reactions -> posts -> threads. Categories are global: remove only
  // rows the test range created (tracked by slug prefix plan005-).
  try {
    const reactions = await db.orm.public.ForumReaction.where({}).all();
    for (const r of reactions) {
      if (r.userId.startsWith(TEST_ID_PREFIX)) {
        await db.orm.public.ForumReaction.where({ id: r.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] forum reactions:", e instanceof Error ? e.message : e);
  }
  try {
    const posts = await db.orm.public.ForumPost.where({}).all();
    for (const p of posts) {
      if (p.authorId.startsWith(TEST_ID_PREFIX)) {
        await db.orm.public.ForumPost.where({ id: p.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] forum posts:", e instanceof Error ? e.message : e);
  }
  try {
    const threads = await db.orm.public.ForumThread.where({}).all();
    for (const t of threads) {
      if (t.authorId.startsWith(TEST_ID_PREFIX)) {
        await db.orm.public.ForumThread.where({ id: t.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] forum threads:", e instanceof Error ? e.message : e);
  }
  try {
    const categories = await db.orm.public.ForumCategory.where({}).all();
    for (const c of categories) {
      if (c.slug.startsWith("plan005-")) {
        await db.orm.public.ForumCategory.where({ id: c.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] forum categories:", e instanceof Error ? e.message : e);
  }
  // Server domain: samples/tokens/reviews/eligibilities/news/updates/resources
  // cascade with the server row — delete servers owned by the test range.
  try {
    const servers = await db.orm.public.Server.where({}).all();
    for (const s of servers) {
      if (testUserIds.has(s.ownerId)) {
        await db.orm.public.Server.where({ id: s.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] servers:", e instanceof Error ? e.message : e);
  }
  // Follows of the test range (server deletion may have already cascaded).
  try {
    const follows = await db.orm.public.ServerFollow.where({}).all();
    for (const f of follows) {
      if (testUserIds.has(f.userId)) {
        await db.orm.public.ServerFollow.where({ id: f.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] server follows:", e instanceof Error ? e.message : e);
  }
  try {
    const memberships = await db.orm.public.ServerMember.where({}).all();
    for (const m of memberships) {
      if (testUserIds.has(m.userId)) {
        await db.orm.public.ServerMember.where({ id: m.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] server memberships:", e instanceof Error ? e.message : e);
  }

  // PLAN-017 G/H: advertising campaigns (metrics cascade via FK) and
  // premium entitlements (standalone rows keyed by subjectId — test fixtures
  // always use ids from the fixed test range). Deleted before users so the
  // advertiser FK never restricts user cleanup.
  try {
    const adCampaigns = await db.orm.public.AdCampaign.where({}).all();
    for (const c of adCampaigns) {
      if (testUserIds.has(c.advertiserId)) {
        const metrics = await db.orm.public.AdMetric.where({ campaignId: c.id }).all();
        for (const m of metrics) {
          await db.orm.public.AdMetric.where({ id: m.id }).delete().catch(() => undefined);
        }
        await db.orm.public.AdCampaign.where({ id: c.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] ad campaigns:", e instanceof Error ? e.message : e);
  }
  try {
    const entitlements = await db.orm.public.Entitlement.where({}).all();
    for (const e of entitlements) {
      if (e.subjectId.startsWith(TEST_ID_PREFIX)) {
        await db.orm.public.Entitlement.where({ id: e.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] entitlements:", e instanceof Error ? e.message : e);
  }

  // PLAN-017 F: SystemLog rows are userless — test-range rows are identified
  // by the X-Request-Id the test range sends (the requestId middleware regex
  // accepts it, so admin-platform routes stamp it onto every log entry).
  try {
    const logs = await db.orm.public.SystemLog.where({}).all();
    for (const l of logs) {
      if (l.requestId && l.requestId.startsWith(TEST_ID_PREFIX)) {
        await db.orm.public.SystemLog.where({ id: l.id }).delete().catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn("[reset] system logs:", e instanceof Error ? e.message : e);
  }

  // 7. Users last (sessions/accounts/reviews cascade)
  for (const uid of testUserIds) {
    await db.orm.public.User.where({ id: uid }).delete().catch(() => undefined);
  }
}

/** Create a test user and return an access token for it. */
export async function createTestUser(
  id: string,
  username: string,
  role: "USER" | "ADMIN" | "MODERATOR",
  tokenFactory: (p: { userId: string; email: string; role: string }) => string
): Promise<string> {
  const email = `${username}@test.local`;
  await db.orm.public.User.where({ id }).delete().catch(() => undefined);
  await db.orm.public.User.create({
    id,
    email,
    username,
    role,
    status: "ACTIVE",
  });
  return tokenFactory({ userId: id, email, role });
}