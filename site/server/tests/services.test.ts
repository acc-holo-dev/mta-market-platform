// PLAN C-009/C-010/C-011: service model, order data, delivery/revision flow.
// Lifecycle: DRAFT -> PENDING_REVIEW -> PUBLISHED (moderator publishes),
// order: PENDING -> IN_PROGRESS -> DELIVERED -> ACCEPTED -> CLOSED
// (alt: CANCELLED, DISPUTED). INV-015: services never issue DRM licenses.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { markServicePurchasePaid } from "../src/lib/commerce";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446401";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655446402";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446403";
const OUTSIDER_ID = "550e8400-e29b-41d4-a716-446655446404";
const SUFFIX = Date.now().toString(36);

const PAID_SERVICE_SLUG = `blk4-svc-paid-${SUFFIX}`;
const FREE_SERVICE_SLUG = `blk4-svc-free-${SUFFIX}`;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[services.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let sellerToken = "";
let buyerToken = "";
let adminToken = "";
let outsiderToken = "";

async function createPaidOrder(): Promise<string> {
  const res = await app
    .post(`/services/${PAID_SERVICE_SLUG}/order`)
    .set("Authorization", `Bearer ${buyerToken}`)
    .send({ buyerNotes: "please use latest MTA" });
  expect(res.status).toBe(201);
  return res.body.servicePurchaseId;
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();

  sellerToken = await createTestUser(SELLER_ID, `blk4svcs_${SUFFIX}`, "USER", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `blk4svcb_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `blk4svca_${SUFFIX}`, "ADMIN", generateAccessToken);
  outsiderToken = await createTestUser(OUTSIDER_ID, `blk4svco_${SUFFIX}`, "USER", generateAccessToken);

  // PLAN L-002: API listing creation requires an APPROVED seller profile.
    await db.orm.public.SellerProfile.create({
    userId: SELLER_ID,
    status: "APPROVED",
    payoutEnabled: true,
  }).catch(() => undefined);

  await db.orm.public.Service.create({
    sellerId: SELLER_ID,
    slug: PAID_SERVICE_SLUG,
    title: "Paid service",
    description: "paid fixture",
    type: "CUSTOM_DEVELOPMENT",
    status: "PUBLISHED",
    price: 5000,
    deliveryDays: 3,
  });
  await db.orm.public.Service.create({
    sellerId: SELLER_ID,
    slug: FREE_SERVICE_SLUG,
    title: "Free consultation",
    description: "free fixture",
    type: "CONSULTATION",
    status: "PUBLISHED",
    price: 0,
    deliveryDays: 1,
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("C-009: service publication lifecycle", () => {
  it("seller cannot publish own service; moderator can", async () => {
    const created = await app
      .post("/services")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        title: "Lifecycle service",
        description: "lifecycle fixture",
        type: "CONFIGURATION",
        price: 1000,
        deliveryDays: 2,
      });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const submit = await app
      .post(`/services/${id}/submit`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(submit.status).toBe(200);

    // A-008 analog: the seller cannot publish own service
    const selfPublish = await app
      .post(`/services/${id}/publish`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(selfPublish.status).toBe(403);

    const publish = await app
      .post(`/services/${id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(publish.status).toBe(200);

    const service = await db.orm.public.Service.where({ id }).first();
    expect(service?.status).toBe("PUBLISHED");
  });
});

describe.skipIf(!dbAvailable)("C-010: service order data", () => {
  it("free service order starts immediately without any payment or license", async () => {
    const res = await app
      .post(`/services/${FREE_SERVICE_SLUG}/order`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("completed");
    expect(res.body.finalPrice).toBe(0);

    const sp = await db.orm.public.ServicePurchase
      .where({ id: res.body.servicePurchaseId })
      .first();
    expect(sp?.status).toBe("IN_PROGRESS");

    // INV-015: no DRM license for service orders (scoped to this buyer —
    // other suites own their own license rows)
    const item = await db.orm.public.OrderItem.where({ id: res.body.orderItemId }).first();
    expect(item?.itemType).toBe("SERVICE");
    const buyerPurchases = await db.orm.public.Purchase
      .where({ buyerId: BUYER_ID })
      .all();
    const purchaseIds = new Set(buyerPurchases.map((p: { id: string }) => p.id));
    const allLicenses = await db.orm.public.License.where({}).all();
    const buyerLicenses = allLicenses.filter((l: { purchaseId: string }) =>
      purchaseIds.has(l.purchaseId)
    );
    expect(buyerLicenses.length).toBe(0);
  });

  it("paid service order stays pending until payment, then starts", async () => {
    const servicePurchaseId = await createPaidOrder();
    let sp = await db.orm.public.ServicePurchase.where({ id: servicePurchaseId }).first();
    expect(sp?.status).toBe("PENDING");
    expect(sp?.finalPrice).toBe(5000);
    expect(sp?.platformFee).toBe(500);
    expect(sp?.sellerRevenue).toBe(4500);

    await markServicePurchasePaid(servicePurchaseId);
    sp = await db.orm.public.ServicePurchase.where({ id: servicePurchaseId }).first();
    expect(sp?.status).toBe("IN_PROGRESS");
  });

  it("seller cannot order own service (400)", async () => {
    const res = await app
      .post(`/services/${PAID_SERVICE_SLUG}/order`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!dbAvailable)("C-011: delivery, revisions, acceptance, dispute", () => {
  it("runs the full delivery -> revision -> deliver -> accept -> close path", async () => {
    const servicePurchaseId = await createPaidOrder();
    await markServicePurchasePaid(servicePurchaseId);

    // outsider cannot touch the order
    const forbidden = await app
      .post(`/services/orders/${servicePurchaseId}/deliver`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ notes: "mine now" });
    expect(forbidden.status).toBe(403);

    const deliver1 = await app
      .post(`/services/orders/${servicePurchaseId}/deliver`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ notes: "v1 delivered", deliverableRef: "uploads/svc/v1.zip" });
    expect(deliver1.status).toBe(201);

    let sp = await db.orm.public.ServicePurchase
      .where({ id: servicePurchaseId })
      .first();
    expect(sp?.status).toBe("DELIVERED");

    // buyer requests a revision (within policy limit)
    const revision = await app
      .post(`/services/orders/${servicePurchaseId}/revision`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ reason: "fix styling" });
    expect(revision.status).toBe(201);
    sp = await db.orm.public.ServicePurchase.where({ id: servicePurchaseId }).first();
    expect(sp?.status).toBe("IN_PROGRESS");

    // seller delivers again, buyer accepts -> revenue settles
    await app
      .post(`/services/orders/${servicePurchaseId}/deliver`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ notes: "v2 delivered" });
    const accept = await app
      .post(`/services/orders/${servicePurchaseId}/accept`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(accept.status).toBe(200);

    sp = await db.orm.public.ServicePurchase.where({ id: servicePurchaseId }).first();
    expect(sp?.status).toBe("ACCEPTED");

    const sellerId = SELLER_ID;
    const balance = await db.orm.public.SellerBalance.where({ userId: sellerId }).first();
    expect(Number(balance?.totalEarned)).toBe(4500);

    const close = await app
      .post(`/services/orders/${servicePurchaseId}/close`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(close.status).toBe(200);
    sp = await db.orm.public.ServicePurchase.where({ id: servicePurchaseId }).first();
    expect(sp?.status).toBe("CLOSED");
  });

  it("enforces the revision policy limit and freezes on dispute", async () => {
    const servicePurchaseId = await createPaidOrder();
    await markServicePurchasePaid(servicePurchaseId);

    for (let round = 0; round < 3; round++) {
      const deliver = await app
        .post(`/services/orders/${servicePurchaseId}/deliver`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ notes: `v${round + 1}` });
      expect(deliver.status).toBe(201);
      const revision = await app
        .post(`/services/orders/${servicePurchaseId}/revision`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ reason: `issue ${round + 1}` });
      expect(revision.status).toBe(201);
    }

    // 4th revision exceeds the policy limit (C-011)
    await app
      .post(`/services/orders/${servicePurchaseId}/deliver`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ notes: "v4" });
    const overLimit = await app
      .post(`/services/orders/${servicePurchaseId}/revision`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ reason: "one more" });
    expect(overLimit.status).toBe(409);

    // dispute freezes the order
    const dispute = await app
      .post(`/services/orders/${servicePurchaseId}/dispute`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(dispute.status).toBe(200);
    const sp = await db.orm.public.ServicePurchase
      .where({ id: servicePurchaseId })
      .first();
    expect(sp?.status).toBe("DISPUTED");

    // frozen: neither delivery nor acceptance can move it
    const frozenDeliver = await app
      .post(`/services/orders/${servicePurchaseId}/deliver`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ notes: "while disputed" });
    expect(frozenDeliver.status).toBe(409);
  });

  it("exchanges order messages between participants only", async () => {
    const servicePurchaseId = await createPaidOrder();

    const outsider = await app
      .get(`/services/orders/${servicePurchaseId}/messages`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(outsider.status).toBe(403);

    await app
      .post(`/services/orders/${servicePurchaseId}/messages`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ body: "hello, question about the order" });
    await app
      .post(`/services/orders/${servicePurchaseId}/messages`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ body: "hi! answering shortly" });

    const messages = await app
      .get(`/services/orders/${servicePurchaseId}/messages`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(messages.status).toBe(200);
    expect(messages.body.total).toBe(2);
    expect(messages.body.data.map((m: { senderRole: string }) => m.senderRole)).toEqual([
      "BUYER",
      "SELLER",
    ]);
  });

  it("cancels a pending order", async () => {
    const servicePurchaseId = await createPaidOrder();
    const cancel = await app
      .post(`/services/orders/${servicePurchaseId}/cancel`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(cancel.status).toBe(200);
    const sp = await db.orm.public.ServicePurchase
      .where({ id: servicePurchaseId })
      .first();
    expect(sp?.status).toBe("CANCELLED");
  });
});
