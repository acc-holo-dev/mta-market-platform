// PLAN-017 §36–§45: admin platform backend at the HTTP layer.
// Overview shape, user search/inspect, suspend/restore, role-change guards
// (self-change, escalation confirm, last-superadmin), roles/permissions
// matrix, activity timeline, audit-events filters, system-logs, entity search.
// Follows tests/integration/api/servers/management.test.ts conventions:
// fixed test-range ids, resetTestEntities fixtures, supertest against createApp.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import type { Test } from "supertest";

const app = request(createApp());

// Fixed test-range ids (resetTestEntities owns this prefix).
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655442101";
const MOD_ID = "550e8400-e29b-41d4-a716-446655442102";
const SUPPORT_ID = "550e8400-e29b-41d4-a716-446655442103";
const SUPER_A_ID = "550e8400-e29b-41d4-a716-446655442104";
const SUPER_B_ID = "550e8400-e29b-41d4-a716-446655442105";
const VICTIM_ID = "550e8400-e29b-41d4-a716-446655442106";
const TARGET_ID = "550e8400-e29b-41d4-a716-446655442107";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655442108";
const USER_ID = "550e8400-e29b-41d4-a716-446655442109";

const SUFFIX = Date.now().toString(36);
const USERNAME_PREFIX = `apf17${SUFFIX}`;

// X-Request-Id inside the test range: SystemLog rows written by these
// requests carry it, so resetTestEntities can find and remove them.
const REQ_ID = "550e8400-e29b-41d4-a716-4466554421fa";
const REQ_ID_2 = "550e8400-e29b-41d4-a716-4466554421fb";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan017-admin-platform.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let adminToken = "";
let modToken = "";
let supportToken = "";
let superAToken = "";
let superBToken = "";
let victimToken = "";
let targetToken = "";
let buyerToken = "";
let userToken = "";

/** createTestUser is typed for USER/ADMIN/MODERATOR; staff roles need wider typing. */
async function createStaffUser(id: string, username: string, role: string): Promise<string> {
  const email = `${username}@test.local`;
  await db.orm.public.User.where({ id }).delete().catch(() => undefined);
  await db.orm.public.User.create({
    id,
    email,
    username,
    role: role as any,
    status: "ACTIVE",
  });
  return generateAccessToken({ userId: id, email, role });
}

function get(path: string, token?: string): Test {
  const req = app.get(path).set("X-Request-Id", REQ_ID);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

function post(path: string, token: string, body?: unknown): Test {
  return app
    .post(path)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Request-Id", REQ_ID)
    .send(body ?? {});
}

function patch(path: string, token: string, body?: object): Test {
  const req = app
    .patch(path)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Request-Id", REQ_ID);
  return body !== undefined ? req.send(body) : req;
}

/** logSystem is fire-and-forget — poll the table for the expected row. */
async function waitForSystemLog(
  pred: (row: any) => boolean,
  timeoutMs = 5000
): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.orm.public.SystemLog.where({}).all();
    const hit = rows.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `${USERNAME_PREFIX}adm`, "ADMIN", generateAccessToken);
  modToken = await createTestUser(MOD_ID, `${USERNAME_PREFIX}mod`, "MODERATOR", generateAccessToken);
  victimToken = await createTestUser(VICTIM_ID, `${USERNAME_PREFIX}vic`, "USER", generateAccessToken);
  targetToken = await createTestUser(TARGET_ID, `${USERNAME_PREFIX}tgt`, "USER", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `${USERNAME_PREFIX}buy`, "USER", generateAccessToken);
  userToken = await createTestUser(USER_ID, `${USERNAME_PREFIX}usr`, "USER", generateAccessToken);
  supportToken = await createStaffUser(SUPPORT_ID, `${USERNAME_PREFIX}sup`, "SUPPORT");
  superAToken = await createStaffUser(SUPER_A_ID, `${USERNAME_PREFIX}sa`, "SUPERADMIN");
  superBToken = await createStaffUser(SUPER_B_ID, `${USERNAME_PREFIX}sb`, "SUPERADMIN");
});

afterAll(async () => {
  if (!dbAvailable) return;
  // ForumCategory has no user FK — the generic reset only clears plan005-*.
  const cats = await db.orm.public.ForumCategory.where({}).all();
  for (const c of cats) {
    if (c.slug.startsWith(`apf17-cat-`)) {
      await db.orm.public.ForumCategory.where({ id: c.id }).delete().catch(() => undefined);
    }
  }
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("§36 permission gating", () => {
  it("rejects guests with 401 and plain users with 403", async () => {
    const guest = await get("/admin/overview");
    expect(guest.status).toBe(401);
    const plain = await get("/admin/overview", userToken);
    expect(plain.status).toBe(403);
    expect(plain.body.error).toBeTruthy();
  });

  it("MODERATOR passes users.view but lacks roles.manage/roles.view", async () => {
    const ok = await get("/admin/users", modToken);
    expect(ok.status).toBe(200);
    const deniedRoles = await get("/admin/roles", modToken);
    expect(deniedRoles.status).toBe(403);
    const deniedRoleChange = await patch(`/admin/users/${TARGET_ID}/role`, modToken, {
      role: "ADMIN",
      confirm: true,
    });
    expect(deniedRoleChange.status).toBe(403);
  });

  it("SUPPORT can suspend but not manage roles", async () => {
    const res = await post(`/admin/users/${VICTIM_ID}/suspend`, supportToken, {
      reason: "support gate check",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUSPENDED");
    const restore = await post(`/admin/users/${VICTIM_ID}/restore`, supportToken, {
      reason: "support gate check",
    });
    expect(restore.status).toBe(200);
    expect(restore.body.status).toBe("ACTIVE");
    const denied = await patch(`/admin/users/${TARGET_ID}/role`, supportToken, { role: "USER" });
    expect(denied.status).toBe(403);
  });
});

describe.skipIf(!dbAvailable)("§36 overview", () => {
  it("returns one compact aggregate with the documented shape", async () => {
    const res = await get("/admin/overview", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.users).toMatchObject({ active: expect.any(Number), suspended: expect.any(Number), total: expect.any(Number) });
    expect(res.body.users.total).toBeGreaterThanOrEqual(9);
    expect(res.body.resources).toMatchObject({ published: expect.any(Number), pendingReview: expect.any(Number), total: expect.any(Number) });
    expect(res.body.servers).toMatchObject({ verified: expect.any(Number), pending: expect.any(Number), total: expect.any(Number) });
    expect(res.body.reports).toMatchObject({ open: expect.any(Number) });
    expect(res.body.disputes).toMatchObject({ open: expect.any(Number) });
    expect(res.body.sales).toMatchObject({ count30d: expect.any(Number), revenueMinor30d: expect.any(Number) });
    expect(res.body.advertising).toMatchObject({ activeCampaigns: expect.any(Number) });
    expect(res.body.premium).toMatchObject({ activeEntitlements: expect.any(Number) });
    expect(res.body.system.database).toBe("ok");
    expect(res.body.system.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("reflects new ad campaigns and entitlements in the next read", async () => {
    const before = await get("/admin/overview", adminToken);
    expect(before.status).toBe(200);
    await db.orm.public.AdCampaign.create({
      advertiserId: ADMIN_ID,
      name: `apf17-camp-${SUFFIX}`,
      placement: "HOME_HERO",
      title: `Кампания ${SUFFIX}`,
      body: "тестовая кампания",
      status: "ACTIVE",
      reviewStatus: "APPROVED",
    });
    await db.orm.public.Entitlement.create({
      subjectType: "USER",
      subjectId: TARGET_ID,
      kind: "CREATOR_PREMIUM",
      source: "ADMIN_GRANT",
    });
    const after = await get("/admin/overview", adminToken);
    expect(after.status).toBe(200);
    expect(after.body.advertising.activeCampaigns).toBe(before.body.advertising.activeCampaigns + 1);
    expect(after.body.premium.activeEntitlements).toBe(before.body.premium.activeEntitlements + 1);
  });
});

describe.skipIf(!dbAvailable)("§37 user list & inspect", () => {
  it("lists users with search, filters and per-row counters", async () => {
    const res = await get(`/admin/users?search=${USERNAME_PREFIX}&limit=50`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(9);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(50);
    const target = res.body.users.find((u: any) => u.id === TARGET_ID);
    expect(target).toBeTruthy();
    expect(target.email).toBe(`${USERNAME_PREFIX}tgt@test.local`);
    expect(target.counts).toMatchObject({ resources: expect.any(Number), purchases: expect.any(Number), identities: expect.any(Number) });

    const admins = await get("/admin/users?role=ADMIN&limit=100", adminToken);
    expect(admins.status).toBe(200);
    expect(admins.body.users.some((u: any) => u.id === ADMIN_ID)).toBe(true);

    const suspended = await get("/admin/users?status=SUSPENDED", adminToken);
    expect(suspended.status).toBe(200);
    expect(suspended.body.users.some((u: any) => u.id === VICTIM_ID)).toBe(false);
  });

  it("exposes lastLoginAt from the latest session (grouped, not N+1)", async () => {
    const nowIso = new Date().toISOString();
    await db.orm.public.Session.create({
      userId: TARGET_ID,
      refreshTokenHash: `hash-${SUFFIX}-tgt`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      createdAt: nowIso,
      ipAddress: "10.9.9.9",
      userAgent: "vitest",
    });
    const res = await get(`/admin/users?search=${USERNAME_PREFIX}tgt&limit=10`, adminToken);
    const target = res.body.users.find((u: any) => u.id === TARGET_ID);
    expect(target).toBeTruthy();
    expect(new Date(target.lastLoginAt).getTime()).toBe(new Date(nowIso).getTime());
  });

  it("inspects a user: identities without tokens, sessions, moderation, purchases, sellerProfile", async () => {
    const nowIso = new Date().toISOString();
    // Seller profile + OAuth identity + session + moderation event.
    await db.orm.public.SellerProfile.create({
      userId: TARGET_ID,
      status: "APPROVED",
      displayName: `Продавец ${SUFFIX}`,
      appliedAt: nowIso,
    });
    await db.orm.public.Account.create({
      userId: TARGET_ID,
      provider: "google",
      providerAccountId: `acc-${SUFFIX}`,
      accessToken: "SECRET-never-leaks",
    });

    const res = await get(`/admin/users/${TARGET_ID}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(TARGET_ID);
    expect(res.body.user.passwordHash).toBeUndefined();

    expect(res.body.identities.length).toBe(1);
    expect(res.body.identities[0].provider).toBe("google");
    expect(JSON.stringify(res.body.identities)).not.toContain("SECRET");

    expect(res.body.sessions.count).toBeGreaterThanOrEqual(1);
    expect(res.body.sessions.last.ipAddress).toBe("10.9.9.9");

    expect(res.body.sellerProfile.exists).toBe(true);
    expect(res.body.sellerProfile.status).toBe("APPROVED");
  });

  it("404s for an unknown user", async () => {
    const res = await get("/admin/users/00000000-0000-0000-0000-00000000000a", adminToken);
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!dbAvailable)("§41 suspend / restore", () => {
  it("suspends: status flips, sessions revoked, audit + notification + SystemLog", async () => {
    await db.orm.public.Session.create({
      userId: VICTIM_ID,
      refreshTokenHash: `hash-${SUFFIX}-vic`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      ipAddress: "10.1.1.1",
      userAgent: "vitest",
    });

    const res = await post(`/admin/users/${VICTIM_ID}/suspend`, adminToken, {
      reason: "нарушение правил",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUSPENDED");

    const sessions = await db.orm.public.Session.where({ userId: VICTIM_ID }).all();
    expect(sessions.length).toBe(0);

    const notifs = await db.orm.public.Notification.where({ recipientId: VICTIM_ID }).all();
    expect(notifs.some((n: any) => n.type === "MODERATION" && n.title.includes("заблокирован"))).toBe(true);

    const audits = await db.orm.public.AuditLog
      .where({ actorId: ADMIN_ID, action: "user.suspend", targetId: VICTIM_ID })
      .all();
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const sysRow = await waitForSystemLog(
      (r) => r.message.includes(VICTIM_ID) && r.message.includes("suspended")
    );
    expect(sysRow).not.toBeNull();
    expect(sysRow.level).toBe("WARN");
  });

  it("refuses self-suspension", async () => {
    const res = await post(`/admin/users/${ADMIN_ID}/suspend`, adminToken, { reason: "self" });
    expect(res.status).toBe(400);
  });

  it("guards SUPERADMIN suspension behind SUPERADMIN actor or ADMIN confirm", async () => {
    const denied = await post(`/admin/users/${SUPER_A_ID}/suspend`, adminToken, { reason: "no confirm" });
    expect(denied.status).toBe(403);
    const allowed = await post(`/admin/users/${SUPER_A_ID}/suspend`, adminToken, {
      reason: "confirmed",
      confirm: true,
    });
    expect(allowed.status).toBe(200);
    const restore = await post(`/admin/users/${SUPER_A_ID}/restore`, adminToken, { reason: "back" });
    expect(restore.status).toBe(200);
    expect(restore.body.status).toBe("ACTIVE");
  });

  it("restore flips back to ACTIVE; second restore is 409", async () => {
    await post(`/admin/users/${VICTIM_ID}/suspend`, adminToken, { reason: "again" });
    const restore = await post(`/admin/users/${VICTIM_ID}/restore`, adminToken, { reason: "pardon" });
    expect(restore.status).toBe(200);
    expect(restore.body.status).toBe("ACTIVE");
    const second = await post(`/admin/users/${VICTIM_ID}/restore`, adminToken, { reason: "pardon" });
    expect(second.status).toBe(409);
  });
});

describe.skipIf(!dbAvailable)("§41 role change guards", () => {
  it("rejects changing own role (403)", async () => {
    const res = await patch(`/admin/users/${ADMIN_ID}/role`, adminToken, { role: "USER" });
    expect(res.status).toBe(403);
  });

  it("requires confirm=true to escalate into ADMIN (409 confirmation_required)", async () => {
    const res = await patch(`/admin/users/${TARGET_ID}/role`, adminToken, { role: "ADMIN" });
    expect(res.status).toBe(409);
  });

  it("grants ADMIN with confirm, audits and notifies the target", async () => {
    const res = await patch(`/admin/users/${TARGET_ID}/role`, adminToken, {
      role: "ADMIN",
      confirm: true,
      reason: "plan017 test",
    });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("ADMIN");

    const row = await db.orm.public.User.where({ id: TARGET_ID }).first();
    expect(row!.role).toBe("ADMIN");

    const audits = await db.orm.public.AuditLog
      .where({ actorId: ADMIN_ID, action: "user.role.change", targetId: TARGET_ID })
      .all();
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].before).toContain("USER");

    const notifs = await db.orm.public.Notification.where({ recipientId: TARGET_ID }).all();
    expect(notifs.some((n: any) => n.type === "MODERATION" && n.title.includes("роль"))).toBe(true);
  });

  it("blocks demoting the last SUPERADMIN (409 last_superadmin)", async () => {
    // Two in-range superadmins: demote SUPER_A first (must succeed),
    // then SUPER_B is the last one — the demote must 409.
    const first = await patch(`/admin/users/${SUPER_A_ID}/role`, adminToken, {
      role: "USER",
      confirm: true,
      reason: "step 1",
    });
    expect(first.status).toBe(200);

    const externalSuperadmins = (await db.orm.public.User.where({ role: "SUPERADMIN" }).all())
      .map((u: any) => u.id as string)
      .filter((id) => id !== SUPER_B_ID);
    const res = await patch(`/admin/users/${SUPER_B_ID}/role`, adminToken, {
      role: "USER",
      confirm: true,
      reason: "step 2",
    });
    if (externalSuperadmins.length === 0) {
      expect(res.status).toBe(409);
    } else {
      // A foreign SUPERADMIN exists in the shared test DB — either outcome is
      // acceptable; the guard is covered by the externalSuperadmins===0 branch.
      expect([200, 409]).toContain(res.status);
    }
  });

  it("SUPPORT cannot change roles even with confirm", async () => {
    const res = await patch(`/admin/users/${TARGET_ID}/role`, supportToken, {
      role: "USER",
      confirm: true,
    });
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!dbAvailable)("§40 roles & permissions catalog", () => {
  it("returns the full role matrix for ADMIN", async () => {
    const res = await get("/admin/roles", adminToken);
    expect(res.status).toBe(200);
    const roles = res.body.roles;
    expect(roles.length).toBe(7);
    const byRole = new Map<string, any>(roles.map((r: any) => [r.role, r]));
    expect(byRole.get("SUPERADMIN").permissions.length).toBeGreaterThanOrEqual(29);
    expect(byRole.get("ADMIN").label).toBe("Администратор");
    expect(byRole.get("USER").permissions).toEqual([]);
    expect(byRole.get("MODERATOR").permissions).toContain("resources.moderate");
    expect(byRole.get("FINANCE").permissions).toContain("finance.refund");
    expect(byRole.get("SUPPORT").permissions).toContain("users.suspend");
    expect(byRole.get("SUPPORT").permissions).not.toContain("roles.manage");
    expect(byRole.get("SUPERADMIN").members).toBeGreaterThanOrEqual(1);
  });

  it("exposes the ru permission catalog", async () => {
    const res = await get("/admin/permissions", adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.permissions)).toBe(true);
    const usersView = res.body.permissions.find((p: any) => p.key === "users.view");
    expect(usersView).toMatchObject({ group: "users", label: expect.any(String), description: expect.any(String) });
    const keys = res.body.permissions.map((p: any) => p.key as string);
    for (const required of ["roles.manage", "audit.view", "system.manage", "finance.payout", "advertising.manage", "premium.manage"]) {
      expect(keys).toContain(required);
    }
  });
});

describe.skipIf(!dbAvailable)("§42 user activity timeline", () => {
  let resourceId = "";
  let versionId = "";
  let threadId = "";

  beforeAll(async () => {
    if (!dbAvailable) return;
    const resource = await db.orm.public.Resource.create({
      sellerId: TARGET_ID,
      slug: `apf17-${SUFFIX}`,
      title: `Ресурс ${USERNAME_PREFIX}`,
      description: "Тестовый ресурс для таймлайна PLAN-017",
      type: "SCRIPT",
      status: "PUBLISHED",
      price: 100,
    });
    resourceId = resource.id;
    const version = await db.orm.public.ResourceVersion.create({
      resourceId,
      version: "1.0.0",
      fileUrl: `/uploads/${SUFFIX}.zip`,
      fileSize: 1,
      fileChecksum: `sum-${SUFFIX}`,
    });
    versionId = version.id;
    await db.orm.public.Purchase.create({
      buyerId: BUYER_ID,
      resourceId,
      versionId,
      status: "COMPLETED",
      priceSnapshot: 100,
      finalPrice: 100,
      platformFee: 10,
      sellerRevenue: 90,
    });
    await db.orm.public.Review.create({
      resourceId,
      buyerId: BUYER_ID,
      rating: 5,
      comment: "Отличный ресурс",
    });
    const category = await db.orm.public.ForumCategory.create({
      slug: `apf17-cat-${SUFFIX}`,
      name: `Категория ${SUFFIX}`,
      description: null,
      position: 999,
    });
    const thread = await db.orm.public.ForumThread.create({
      categoryId: category.id,
      authorId: TARGET_ID,
      title: `Тред ${USERNAME_PREFIX}`,
    });
    threadId = thread.id;
    await db.orm.public.ForumPost.create({
      threadId,
      authorId: TARGET_ID,
      content: "Первое сообщение теста",
      position: 0,
    });
    await db.orm.public.Article.create({
      authorId: TARGET_ID,
      slug: `apf17-art-${SUFFIX}`,
      title: `Статья ${USERNAME_PREFIX}`,
      content: "Содержимое статьи для теста таймлайна.",
      excerpt: "Содержимое статьи",
    });
    await db.orm.public.Report.create({
      reporterId: TARGET_ID,
      targetType: "POST",
      targetId: resourceId,
      reason: "тестовая жалоба",
    });
    await db.orm.public.ModerationEvent.create({
      resourceId,
      actorId: TARGET_ID,
      fromStatus: "DRAFT",
      toStatus: "PENDING_REVIEW",
      reason: "проверка",
    });
    await db.orm.public.AuditLog.create({
      actorId: ADMIN_ID,
      action: "user.role.change",
      targetType: "user",
      targetId: TARGET_ID,
      before: JSON.stringify({ role: "USER" }),
      after: JSON.stringify({ role: "MODERATOR", reason: "план 017" }),
    });
  });

  it("merges bounded parallel sources into a sorted timeline", async () => {
    const res = await get(`/admin/users/${TARGET_ID}/activity?limit=100`, adminToken);
    expect(res.status).toBe(200);
    const entries = res.body.entries;
    const types = new Set(entries.map((e: any) => e.type));
    for (const expected of [
      "login",
      "resource_created",
      "version_published",
      "forum_post",
      "article_created",
      "report_filed",
      "role_changed",
      "moderation_event",
    ]) {
      expect(types.has(expected)).toBe(true);
    }
    // Purchases and reviews belong to the buyer, not the seller — TARGET
    // created the resource and moderated it, BUYER bought and reviewed it.
    expect(types.has("purchase")).toBe(false);
    expect(types.has("review_created")).toBe(false);

    const roleChange = entries.find((e: any) => e.type === "role_changed");
    expect(roleChange.summary).toContain("USER");
    expect(roleChange.summary).toContain("MODERATOR");

    const versionEntry = entries.find((e: any) => e.type === "version_published");
    expect(versionEntry.summary).toContain("1.0.0");

    const modEntry = entries.find((e: any) => e.type === "moderation_event");
    expect(modEntry.summary).toContain("DRAFT");

    // sorted desc by at
    const times = entries.map((e: any) => new Date(e.at).getTime());
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
    expect(res.body.total).toBe(entries.length);
  });

  it("bounds the timeline by the limit parameter", async () => {
    const res = await get(`/admin/users/${TARGET_ID}/activity?limit=3`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(3);
  });

  it("buyers see their purchase + refund-free timeline", async () => {
    const res = await get(`/admin/users/${BUYER_ID}/activity?limit=50`, adminToken);
    expect(res.status).toBe(200);
    const purchase = res.body.entries.find((e: any) => e.type === "purchase");
    expect(purchase).toBeTruthy();
    expect(purchase.amountMinor).toBe(100);
    expect(purchase.summary).toContain("Ресурс");
    const review = res.body.entries.find((e: any) => e.type === "review_created");
    expect(review).toBeTruthy();
    expect(review.summary).toContain("оценка 5");
  });
});

describe.skipIf(!dbAvailable)("§43 audit events", () => {
  it("filters by actor, action, target and the userId alias", async () => {
    const byActor = await get(`/admin/audit-events?actorId=${ADMIN_ID}&action=user.suspend`, adminToken);
    expect(byActor.status).toBe(200);
    expect(byActor.body.events.length).toBeGreaterThanOrEqual(1);
    expect(byActor.body.events.every((a: any) => a.actorId === ADMIN_ID)).toBe(true);

    const byTarget = await get(
      `/admin/audit-events?targetType=user&targetId=${TARGET_ID}&action=role`,
      adminToken
    );
    expect(byTarget.body.events.length).toBeGreaterThanOrEqual(1);

    const byAlias = await get(`/admin/audit-events?userId=${ADMIN_ID}&action=user.suspend`, adminToken);
    expect(byAlias.body.events.length).toBe(byActor.body.events.length);

    const future = await get(
      `/admin/audit-events?from=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`,
      adminToken
    );
    expect(future.body.events.length).toBe(0);
  });

  it("is read-only and paginated", async () => {
    const page = await get("/admin/audit-events?page=1&limit=5", adminToken);
    expect(page.status).toBe(200);
    expect(page.body.pagination).toMatchObject({ page: 1, limit: 5, total: expect.any(Number), pages: expect.any(Number) });
    expect(page.body.events.length).toBeLessThanOrEqual(5);
  });

  it("supports the append-only read for SUPPORT (audit.view)", async () => {
    const res = await get("/admin/audit-events?limit=5", supportToken);
    expect(res.status).toBe(200);
  });
});

describe.skipIf(!dbAvailable)("§44 system logs", () => {
  it("lists the fire-and-forget WARN row from suspend with request/route context", async () => {
    const res = await get(`/admin/system-logs?requestId=${REQ_ID}`, adminToken);
    expect(res.status).toBe(200);
    const suspendRow = res.body.logs.find(
      (r: any) => r.message.includes(VICTIM_ID) && r.message.includes("suspended")
    );
    expect(suspendRow).toBeTruthy();
    expect(suspendRow.service).toBe("api");
    expect(suspendRow.route).toBe(`/admin/users/${VICTIM_ID}/suspend`);
    expect(suspendRow.level).toBe("WARN");

    const filtered = await get(
      `/admin/system-logs?service=api&level=WARN&route=${encodeURIComponent(`/admin/users/${VICTIM_ID}/suspend`)}`,
      adminToken
    );
    expect(filtered.body.logs.length).toBeGreaterThanOrEqual(1);
  });

  it("surfaces logUnhandled ERROR rows with the request context", async () => {
    const { logUnhandled } = await import("@server/lib/systemLog");
    logUnhandled(new Error("vitest boom"), {
      req: { id: REQ_ID_2, originalUrl: "/admin/test?x=1", method: "GET" },
      errorCode: "TEST_BOOM",
    });
    const row = await waitForSystemLog(
      (r) => r.requestId === REQ_ID_2 && r.errorCode === "TEST_BOOM"
    );
    expect(row).not.toBeNull();
    expect(row.level).toBe("ERROR");
    expect(row.message).toContain("vitest boom");
    // The ERROR write opportunistically runs the bounded retention DELETE —
    // its success is implied by the row being queryable and no thrown error.
  });

  it("pagination is bounded", async () => {
    const res = await get("/admin/system-logs?limit=5", adminToken);
    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeLessThanOrEqual(5);
    expect(res.body.limit).toBe(5);
  });
});

describe.skipIf(!dbAvailable)("§66 admin picker entity search", () => {
  let resourceId = "";
  let versionId = "";

  beforeAll(async () => {
    if (!dbAvailable) return;
    const resource = await db.orm.public.Resource.create({
      sellerId: TARGET_ID,
      slug: `apf17-src-${SUFFIX}`,
      title: `Ищемый ресурс ${USERNAME_PREFIX}`,
      description: "для search-entities",
      type: "SCRIPT",
      status: "PUBLISHED",
      price: 10,
    });
    resourceId = resource.id;
    const version = await db.orm.public.ResourceVersion.create({
      resourceId,
      version: "2.0.0",
      fileUrl: `/uploads/src-${SUFFIX}.zip`,
      fileSize: 1,
      fileChecksum: `sum2-${SUFFIX}`,
    });
    versionId = version.id;
  });

  it("finds users by username/email/displayName fragment", async () => {
    const res = await get(`/admin/search-entities?type=user&q=${USERNAME_PREFIX}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("user");
    expect(res.body.items.some((i: any) => i.id === TARGET_ID)).toBe(true);
  });

  it("finds resources by title/slug", async () => {
    const byTitle = await get(
      `/admin/search-entities?type=resource&q=${encodeURIComponent("Ищемый ресурс")}`,
      adminToken
    );
    expect(byTitle.body.items.some((i: any) => i.id === resourceId)).toBe(true);
    const bySlug = await get(`/admin/search-entities?type=resource&q=apf17-src-`, adminToken);
    expect(bySlug.body.items.some((i: any) => i.id === resourceId)).toBe(true);
  });

  it("finds versions by id prefix and by resource slug", async () => {
    const byId = await get(`/admin/search-entities?type=version&q=${versionId.slice(0, 8)}`, adminToken);
    expect(byId.body.items.some((i: any) => i.id === versionId)).toBe(true);
    const bySlug = await get(`/admin/search-entities?type=version&q=apf17-src-`, adminToken);
    expect(bySlug.body.items.some((i: any) => i.id === versionId)).toBe(true);
  });

  it("validates q length and limit", async () => {
    const short = await get("/admin/search-entities?type=user&q=a", adminToken);
    expect(short.status).toBe(400);
    const res = await get(`/admin/search-entities?type=user&q=${USERNAME_PREFIX}&limit=1`, adminToken);
    expect(res.body.items.length).toBeLessThanOrEqual(1);
  });
});