// PLAN-018 L integration tests: protected deal rooms.
// Covers: the full happy path CREATED→FUNDED→DELIVERING→DELIVERED→ACCEPTED→
// CLOSED (with auto resolve), the guard matrix (outsider 404 existence
// hiding, wrong-party 403, wrong-state 409), messages/evidence access rules,
// the dispute path with admin resolve, and admin queue + audited overrides.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655448001";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655448002";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655448003";
const OUTSIDER_ID = "550e8400-e29b-41d4-a716-446655448004";
const BUYER2_ID = "550e8400-e29b-41d4-a716-446655448005";
const SELLER2_ID = "550e8400-e29b-41d4-a716-446655448006";
const SUFFIX = Date.now().toString(36);

let adminToken = "";
let buyerToken = "";
let sellerToken = "";
let outsiderToken = "";
let buyer2Token = "";
let seller2Token = "";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[deals.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const DEAL_USER_IDS = [ADMIN_ID, BUYER_ID, SELLER_ID, OUTSIDER_ID, BUYER2_ID, SELLER2_ID];

/** FK-safe cleanup for everything this suite created (db-reset is frozen). */
async function cleanupWaveEntities(): Promise<void> {
  const rooms = (await db.orm.public.DealRoom.where({}).all()) as Array<{ id: string; buyerId: string; sellerId: string }>;
  for (const room of rooms) {
    if (!DEAL_USER_IDS.includes(room.buyerId) && !DEAL_USER_IDS.includes(room.sellerId)) continue;
    const messages = (await db.orm.public.DealMessage.where({ roomId: room.id } as any).all()) as Array<{ id: string }>;
    for (const m of messages) {
      await db.orm.public.DealMessage.where({ id: m.id }).delete().catch(() => undefined);
    }
    const evidence = (await db.orm.public.DealEvidence.where({ roomId: room.id } as any).all()) as Array<{ id: string }>;
    for (const e of evidence) {
      await db.orm.public.DealEvidence.where({ id: e.id }).delete().catch(() => undefined);
    }
    await db.orm.public.DealRoom.where({ id: room.id }).delete().catch(() => undefined);
  }
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `dladmin_${SUFFIX}`, "ADMIN", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `dlbuyer_${SUFFIX}`, "USER", generateAccessToken);
  sellerToken = await createTestUser(SELLER_ID, `dlseller_${SUFFIX}`, "USER", generateAccessToken);
  outsiderToken = await createTestUser(OUTSIDER_ID, `dloutsdr_${SUFFIX}`, "USER", generateAccessToken);
  buyer2Token = await createTestUser(BUYER2_ID, `dlbuyer2_${SUFFIX}`, "USER", generateAccessToken);
  seller2Token = await createTestUser(SELLER2_ID, `dlseller2_${SUFFIX}`, "USER", generateAccessToken);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanupWaveEntities();
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("protected deal rooms", () => {
  let roomId = "";

  it("creates a room by the buyer; the seller is auto-member; status CREATED", async () => {
    const res = await app
      .post("/deals")
      .set(auth(buyerToken))
      .send({
        counterpartyId: SELLER_ID,
        title: "Кастомный скрипт под сервер",
        amountMinor: 150000,
        subjectType: "resource",
        subjectId: "550e8400-e29b-41d4-a716-446655448010",
      });
    expect(res.status).toBe(201);
    roomId = res.body.room.id;
    expect(res.body.room.status).toBe("CREATED");
    expect(res.body.room.buyerId).toBe(BUYER_ID);
    expect(res.body.room.sellerId).toBe(SELLER_ID);
    expect(res.body.room.amountMinor).toBe(150000);
    expect(res.body.room.currency).toBe("RUB");

    // The counterparty sees the room; an outsider does not (existence hiding).
    const sellerView = await app.get(`/deals/${roomId}`).set(auth(sellerToken));
    expect(sellerView.status).toBe(200);
    expect(sellerView.body.role).toBe("seller");
    const outsiderView = await app.get(`/deals/${roomId}`).set(auth(outsiderToken));
    expect(outsiderView.status).toBe(404);
    expect(outsiderView.body).toEqual({ error: "Not found" });

    // Anonymous creation is 401; self-deal is 400; unknown counterparty 404.
    const anon = await app.post("/deals").send({ counterpartyId: SELLER_ID, title: "x", amountMinor: 1 });
    expect(anon.status).toBe(401);
    const self = await app.post("/deals").set(auth(buyerToken)).send({ counterpartyId: BUYER_ID, title: "x", amountMinor: 1 });
    expect(self.status).toBe(400);
    const ghost = await app
      .post("/deals")
      .set(auth(buyerToken))
      .send({ counterpartyId: "550e8400-e29b-41d4-a716-4466554480ff", title: "x", amountMinor: 1 });
    expect(ghost.status).toBe(404);
  });

  it("enforces the guard matrix: wrong party 403, wrong state 409", async () => {
    // mark_funded is buyer-only.
    const sellerFund = await app
      .post(`/deals/${roomId}/transition`)
      .set(auth(sellerToken))
      .send({ action: "mark_funded" });
    expect(sellerFund.status).toBe(403);
    expect(sellerFund.body.code).toBe("wrong_party");
    // start_delivery is seller-only.
    const buyerDelivery = await app
      .post(`/deals/${roomId}/transition`)
      .set(auth(buyerToken))
      .send({ action: "start_delivery" });
    expect(buyerDelivery.status).toBe(403);
    // accept before DELIVERED is a state error.
    const earlyAccept = await app
      .post(`/deals/${roomId}/transition`)
      .set(auth(buyerToken))
      .send({ action: "accept" });
    expect(earlyAccept.status).toBe(409);
    // resolve is admin-only even in the wrong state.
    const buyerResolve = await app.post(`/deals/${roomId}/transition`).set(auth(buyerToken)).send({ action: "resolve" });
    expect(buyerResolve.status).toBe(403);
    const outsiderResolve = await app.post(`/deals/${roomId}/transition`).set(auth(outsiderToken)).send({ action: "resolve" });
    expect(outsiderResolve.status).toBe(404);
  });

  it("walks the full happy path CREATED→FUNDED→DELIVERING→DELIVERED→ACCEPTED→CLOSED", async () => {
    // mark_funded: buyer asserts external payment (bounded workspace, no rail);
    // an optional commerce order reference can be linked.
    const funded = await app
      .post(`/deals/${roomId}/transition`)
      .set(auth(buyerToken))
      .send({ action: "mark_funded", note: "Перевод по СБП, код 4821" });
    expect(funded.status).toBe(200);
    expect(funded.body.room.status).toBe("FUNDED");
    expect(funded.body.from).toBe("CREATED");
    expect(funded.body.to).toBe("FUNDED");

    // A repeated mark_funded is a state error now.
    const repeat = await app.post(`/deals/${roomId}/transition`).set(auth(buyerToken)).send({ action: "mark_funded" });
    expect(repeat.status).toBe(409);

    const delivering = await app.post(`/deals/${roomId}/transition`).set(auth(sellerToken)).send({ action: "start_delivery" });
    expect(delivering.status).toBe(200);
    expect(delivering.body.room.status).toBe("DELIVERING");

    const delivered = await app
      .post(`/deals/${roomId}/transition`)
      .set(auth(sellerToken))
      .send({ action: "mark_delivered", note: "Архив выслан в личку" });
    expect(delivered.status).toBe(200);
    expect(delivered.body.room.status).toBe("DELIVERED");

    // accept with auto-RESOLVED+CLOSED (buyer opt-in).
    const accepted = await app
      .post(`/deals/${roomId}/transition`)
      .set(auth(buyerToken))
      .send({ action: "accept", resolveAndClose: true });
    expect(accepted.status).toBe(200);
    expect(accepted.body.room.status).toBe("CLOSED");

    // Terminal state: further transitions are 409.
    const again = await app.post(`/deals/${roomId}/transition`).set(auth(sellerToken)).send({ action: "start_delivery" });
    expect(again.status).toBe(409);

    // The transition notes were captured as evidence rows.
    const evidence = await app.get(`/deals/${roomId}/evidence`).set(auth(buyerToken));
    expect(evidence.status).toBe(200);
    const bodies = evidence.body.data.map((e: any) => e.kind);
    expect(bodies).toContain("MESSAGE"); // mark_funded note
    expect(bodies).toContain("DELIVERY"); // mark_delivered note

    // Audits exist for every transition.
    const audits = (await db.orm.public.AuditLog
      .where({ action: "deal_transitioned", targetType: "dealRoom", targetId: roomId } as any)
      .all()) as any[];
    expect(audits.length).toBeGreaterThanOrEqual(5);
  });

  it("messages: parties post/read, admin reads, outsider 404", async () => {
    const room = await app
      .post("/deals")
      .set(auth(buyer2Token))
      .send({ counterpartyId: SELLER2_ID, title: "Правки мода", amountMinor: 50000 });
    const id = room.body.room.id as string;

    const m1 = await app.post(`/deals/${id}/messages`).set(auth(buyer2Token)).send({ body: "Готово к созвону?" });
    expect(m1.status).toBe(201);
    expect(m1.body.message.authorId).toBe(BUYER2_ID);
    const m2 = await app.post(`/deals/${id}/messages`).set(auth(seller2Token)).send({ body: "Да, в 18:00" });
    expect(m2.status).toBe(201);

    const list = await app.get(`/deals/${id}/messages`).set(auth(seller2Token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    const adminList = await app.get(`/deals/${id}/messages`).set(auth(adminToken));
    expect(adminList.status).toBe(200);
    expect(adminList.body.data).toHaveLength(2);
    const stranger = await app.get(`/deals/${id}/messages`).set(auth(outsiderToken));
    expect(stranger.status).toBe(404);
    const strangerPost = await app.post(`/deals/${id}/messages`).set(auth(outsiderToken)).send({ body: "hi" });
    expect(strangerPost.status).toBe(404);

    // Admin cannot post into the parties' workspace (party-only surface).
    const adminPost = await app.post(`/deals/${id}/messages`).set(auth(adminToken)).send({ body: "moderator note" });
    expect(adminPost.status).toBe(403);
    const emptyBody = await app.post(`/deals/${id}/messages`).set(auth(buyer2Token)).send({ body: "" });
    expect(emptyBody.status).toBe(400);

    // my rooms list carries the room on both sides.
    const mineBuyer = await app.get("/deals/mine").set(auth(buyer2Token));
    expect(mineBuyer.body.data.map((r: any) => r.id)).toContain(id);
    const sellerView = await app.get("/deals/mine").set(auth(seller2Token));
    expect(sellerView.body.data.map((r: any) => r.id)).toContain(id);
  });

  it("evidence: FILE stores url only, MESSAGE requires a body, admin can read", async () => {
    const room = await app
      .post("/deals")
      .set(auth(buyer2Token))
      .send({ counterpartyId: SELLER2_ID, title: "Доказательства", amountMinor: 20000 });
    const id = room.body.room.id as string;

    const file = await app
      .post(`/deals/${id}/evidence`)
      .set(auth(seller2Token))
      .send({ kind: "FILE", url: "https://cdn.example.com/proof.zip", body: "should be dropped" });
    expect(file.status).toBe(201);
    expect(file.body.evidence.kind).toBe("FILE");
    expect(file.body.evidence.url).toBe("https://cdn.example.com/proof.zip");
    expect(file.body.evidence.body).toBeNull();

    const msg = await app.post(`/deals/${id}/evidence`).set(auth(buyer2Token)).send({ kind: "MESSAGE", body: "Скрин оплаты" });
    expect(msg.status).toBe(201);
    expect(msg.body.evidence.body).toBe("Скрин оплаты");
    expect(msg.body.evidence.url).toBeNull();

    const fileNoUrl = await app.post(`/deals/${id}/evidence`).set(auth(seller2Token)).send({ kind: "FILE" });
    expect(fileNoUrl.status).toBe(400);
    const msgNoBody = await app.post(`/deals/${id}/evidence`).set(auth(buyer2Token)).send({ kind: "MESSAGE" });
    expect(msgNoBody.status).toBe(400);

    const adminRead = await app.get(`/deals/${id}/evidence`).set(auth(adminToken));
    expect(adminRead.status).toBe(200);
    expect(adminRead.body.data).toHaveLength(2);
    const stranger = await app.get(`/deals/${id}/evidence`).set(auth(outsiderToken));
    expect(stranger.status).toBe(404);
  });

  it("dispute path: either party opens, admin resolves, parties close", async () => {
    const room = await app
      .post("/deals")
      .set(auth(buyer2Token))
      .send({ counterpartyId: SELLER2_ID, title: "Спорная сделка", amountMinor: 30000 });
    const id = room.body.room.id as string;

    const funded = await app.post(`/deals/${id}/transition`).set(auth(buyer2Token)).send({ action: "mark_funded" });
    expect(funded.status).toBe(200);

    // Either party may open a dispute (seller here).
    const disputed = await app
      .post(`/deals/${id}/transition`)
      .set(auth(seller2Token))
      .send({ action: "open_dispute", note: "Покупатель требует другой объём" });
    expect(disputed.status).toBe(200);
    expect(disputed.body.room.status).toBe("DISPUTED");

    // The dispute event evidence was recorded; admins see it.
    const evidence = await app.get(`/deals/${id}/evidence`).set(auth(adminToken));
    expect(evidence.body.data.some((e: any) => e.kind === "DISPUTE_EVENT")).toBe(true);

    // Parties cannot resolve; admin does.
    const buyerResolve = await app.post(`/deals/${id}/transition`).set(auth(buyer2Token)).send({ action: "resolve" });
    expect(buyerResolve.status).toBe(403);
    const resolved = await app
      .post(`/admin/deals/${id}/transition`)
      .set(auth(adminToken))
      .send({ action: "resolve", note: "Договорились: частичный возврат" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.room.status).toBe("RESOLVED");

    // A party closes after RESOLVED.
    const closed = await app.post(`/deals/${id}/transition`).set(auth(buyer2Token)).send({ action: "close" });
    expect(closed.status).toBe(200);
    expect(closed.body.room.status).toBe("CLOSED");
  });

  it("admin queue lists rooms and force-closes from any non-CLOSED state (audited)", async () => {
    const room = await app
      .post("/deals")
      .set(auth(buyerToken))
      .send({ counterpartyId: SELLER_ID, title: "Админский кейс", amountMinor: 10000 });
    const id = room.body.room.id as string;

    const guard = await app.get("/admin/deals?status=CREATED").set(auth(outsiderToken));
    expect(guard.status).toBe(403);

    const queue = await app.get("/admin/deals?status=CREATED").set(auth(adminToken));
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((r: any) => r.id)).toContain(id);
    expect(queue.body.pagination.total).toBeGreaterThanOrEqual(1);

    // Force close from CREATED (party close would be 409 here).
    const partyClose = await app.post(`/deals/${id}/transition`).set(auth(buyerToken)).send({ action: "close" });
    expect(partyClose.status).toBe(409);
    const forceClose = await app.post(`/admin/deals/${id}/transition`).set(auth(adminToken)).send({ action: "close" });
    expect(forceClose.status).toBe(200);
    expect(forceClose.body.room.status).toBe("CLOSED");

    const audits = (await db.orm.public.AuditLog
      .where({ action: "deal_transitioned", targetId: id, actorId: ADMIN_ID } as any)
      .all()) as any[];
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
