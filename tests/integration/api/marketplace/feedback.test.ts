// PLAN-018 S-005: controlled beta feedback integration tests.
// Submit (validated), mine, admin queue, audited transitions.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const U1 = "550e8400-e29b-41d4-a716-446655440050";
const U2 = "550e8400-e29b-41d4-a716-446655440051";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440052";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[feedback.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let u1 = "";
let u2 = "";
let adminToken = "";
let reportId = "";

async function cleanup(): Promise<void> {
  await resetTestEntities();
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
  u1 = await createTestUser(U1, `fu1_${SUFFIX}`, "USER", generateAccessToken);
  u2 = await createTestUser(U2, `fu2_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `fadmin_${SUFFIX}`, "ADMIN", generateAccessToken);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
});

describe.skipIf(!dbAvailable)("feedback — user submission", () => {
  it("unauthenticated submit → 401", async () => {
    const res = await app.post("/feedback").send({
      category: "BUG",
      severity: "HIGH",
      description: "Something is broken in checkout flow",
    });
    expect(res.status).toBe(401);
  });

  it("valid submission → 201 NEW row", async () => {
    const res = await app
      .post("/feedback")
      .set("Authorization", `Bearer ${u1}`)
      .send({
        category: "BUG",
        severity: "HIGH",
        description: "Checkout button does nothing on the second step",
        route: "/checkout",
        screenshotUrl: "/media/media-abc123.png",
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("NEW");
    expect(res.body.category).toBe("BUG");
    expect(res.body.severity).toBe("HIGH");
    reportId = res.body.id;
  });

  it("invalid category/severity/short description → 400", async () => {
    const badCategory = await app
      .post("/feedback")
      .set("Authorization", `Bearer ${u1}`)
      .send({ category: "SPAM", severity: "LOW", description: "long enough description here" });
    expect(badCategory.status).toBe(400);

    const badSeverity = await app
      .post("/feedback")
      .set("Authorization", `Bearer ${u1}`)
      .send({ category: "BUG", severity: "EXTREME", description: "long enough description here" });
    expect(badSeverity.status).toBe(400);

    const short = await app
      .post("/feedback")
      .set("Authorization", `Bearer ${u1}`)
      .send({ category: "UX", severity: "LOW", description: "tiny" });
    expect(short.status).toBe(400);
  });

  it("mine lists only own submissions", async () => {
    await app.post("/feedback").set("Authorization", `Bearer ${u2}`).send({
      category: "UX",
      description: "The filters panel is confusing on mobile screens",
    });

    const mine = await app.get("/feedback/mine").set("Authorization", `Bearer ${u1}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.every((r: { userId: string }) => r.userId === U1)).toBe(true);
    expect(mine.body.data.some((r: { id: string }) => r.id === reportId)).toBe(true);

    const mine2 = await app.get("/feedback/mine").set("Authorization", `Bearer ${u2}`);
    expect(mine2.status).toBe(200);
    expect(mine2.body.data.every((r: { userId: string }) => r.userId === U2)).toBe(true);
  });
});

describe.skipIf(!dbAvailable)("feedback — admin triage queue", () => {
  it("non-admin cannot access the queue (403)", async () => {
    const res = await app.get("/admin/feedback").set("Authorization", `Bearer ${u1}`);
    expect(res.status).toBe(403);
  });

  it("admin queue with status filter returns NEW reports", async () => {
    const res = await app
      .get("/admin/feedback?status=NEW")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((r: { id: string }) => r.id === reportId)).toBe(true);
  });

  it("triage → TRIAGED with handler, audited", async () => {
    const res = await app
      .post(`/admin/feedback/${reportId}/transition`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "triage" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("TRIAGED");
    expect(res.body.handledById).toBe(ADMIN_ID);

    const audit = await db.orm.public.AuditLog
      .where({ action: "feedback_transitioned", targetId: reportId })
      .first();
    expect(audit).toBeTruthy();
    expect(audit!.actorId).toBe(ADMIN_ID);
  });

  it("resolve with resolution note → RESOLVED, audited", async () => {
    const res = await app
      .post(`/admin/feedback/${reportId}/transition`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "resolve", resolutionNote: "Fixed in build 42" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RESOLVED");
    expect(res.body.resolutionNote).toBe("Fixed in build 42");

    const audits = await db.orm.public.AuditLog
      .where({ action: "feedback_transitioned", targetId: reportId })
      .all();
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.some((a: { after: string | null }) => (a.after ?? "").includes("RESOLVED"))).toBe(true);
  });

  it("dismiss works; unknown transition target → 404", async () => {
    const mine2 = await app.get("/feedback/mine").set("Authorization", `Bearer ${u2}`);
    const u2id = mine2.body.data[0].id;

    const dismissed = await app
      .post(`/admin/feedback/${u2id}/transition`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "dismiss", resolutionNote: "Duplicate report" });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.status).toBe("DISMISSED");

    const missing = await app
      .post("/admin/feedback/00000000-0000-0000-0000-000000000000/transition")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "resolve" });
    expect(missing.status).toBe(404);
  });

  it("user cannot transition (403)", async () => {
    const res = await app
      .post(`/admin/feedback/${reportId}/transition`)
      .set("Authorization", `Bearer ${u1}`)
      .send({ action: "resolve" });
    expect(res.status).toBe(403);
  });
});