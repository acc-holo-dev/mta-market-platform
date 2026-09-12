// PLAN-017 G integration tests: advertising control center + public serving.
// Covers: placement serving (empty + public projection), campaign lifecycle
// (create -> approve -> activate), event metrics + analytics, pause/resume,
// review rejections, expiry sweep, feature-flag honesty (404 when off).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import { resetExpirySweepGuardForTests } from "@server/lib/advertising";

const app = request(createApp());

// Fixed test-range ids (resetTestEntities wipes everything with this prefix).
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655447501";
const MOD_ID = "550e8400-e29b-41d4-a716-446655447502";
const OTHER_ADMIN_ID = "550e8400-e29b-41d4-a716-446655447503";
const SUFFIX = Date.now().toString(36);

let adminToken = "";
let modToken = "";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[advertising.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  // FEATURE_* env override contract (lib/featureFlags.ts): forced on for the
  // whole suite — config/application/features.yaml has advertising: false.
  process.env.FEATURE_ADVERTISING = "true";
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `adadmin_${SUFFIX}`, "ADMIN", generateAccessToken);
  modToken = await createTestUser(MOD_ID, `admod_${SUFFIX}`, "MODERATOR", generateAccessToken);
  await createTestUser(OTHER_ADMIN_ID, `adadmin2_${SUFFIX}`, "ADMIN", generateAccessToken);
});

afterAll(async () => {
  if (!dbAvailable) return;
  delete process.env.FEATURE_ADVERTISING;
  await resetTestEntities();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createCampaign(payload: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await app.post("/admin/advertising/campaigns").set(auth(adminToken)).send(payload);
  return { status: res.status, body: res.body };
}

const BASE = {
  placement: "HOME_HERO",
  name: "Test campaign",
  title: "Buy widgets",
  body: "Widgets for everyone",
  priority: 5,
};

describe.skipIf(!dbAvailable)("advertising control center", () => {
  let campaignA = "";

  it("serves an empty placement list before any campaign exists", async () => {
    const res = await app.get("/advertising/placements/HOME_HERO");
    expect(res.status).toBe(200);
    expect(res.body.placement).toBe("HOME_HERO");
    expect(res.body.items).toEqual([]);
  });

  it("rejects an unknown placement with 400", async () => {
    const res = await app.get("/advertising/placements/NOT_A_PLACEMENT");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("guards the admin surface: 401 without token, 403 for non-ADMIN/SUPERADMIN", async () => {
    const anon = await app.post("/admin/advertising/campaigns").send({ name: "x" });
    expect(anon.status).toBe(401);
    const mod = await app
      .get("/admin/advertising/campaigns")
      .set(auth(modToken));
    expect(mod.status).toBe(403);
  });

  it("admin creates a campaign as DRAFT + PENDING with the acting admin as advertiser", async () => {
    const res = await createCampaign({ ...BASE, placement: "HOME_HERO", ctaLabel: "Open", ctaUrl: "https://example.com" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.reviewStatus).toBe("PENDING");
    expect(res.body.advertiserId).toBe(ADMIN_ID);
    campaignA = res.body.id;
  });

  it("approve keeps the status and flips reviewStatus to APPROVED", async () => {
    const res = await app.post(`/admin/advertising/campaigns/${campaignA}/transition`).set(auth(adminToken)).send({ action: "approve" });
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe("APPROVED");
    expect(res.body.status).toBe("DRAFT");
  });

  it("activate moves an APPROVED DRAFT campaign to ACTIVE", async () => {
    const res = await app.post(`/admin/advertising/campaigns/${campaignA}/transition`).set(auth(adminToken)).send({ action: "activate" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACTIVE");
  });

  it("placement returns the campaign with ONLY public fields", async () => {
    const res = await app.get("/advertising/placements/HOME_HERO");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(Object.keys(item).sort()).toEqual(["body", "ctaLabel", "ctaUrl", "id", "imageUrl", "title"]);
    expect(item.id).toBe(campaignA);
    expect(item.title).toBe("Buy widgets");
    expect(item.ctaLabel).toBe("Open");
    expect(JSON.stringify(item)).not.toContain("advertiserId");
    expect(JSON.stringify(res.body)).not.toContain("reviewStatus");
  });

  it("records impressions + clicks and analytics totals + ctr follow", async () => {
    for (let i = 0; i < 2; i += 1) {
      const imp = await app.post("/advertising/events/impression").send({ campaignId: campaignA });
      expect(imp.status).toBe(204);
    }
    const click = await app.post("/advertising/events/click").send({ campaignId: campaignA });
    expect(click.status).toBe(204);

    const res = await app.get(`/admin/advertising/campaigns/${campaignA}/analytics`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.totals.impressions).toBe(2);
    expect(res.body.totals.clicks).toBe(1);
    expect(res.body.totals.ctr).toBe(0.5);
    expect(res.body.byDay.length).toBeGreaterThanOrEqual(1);
    expect(res.body.byDay[0].impressions).toBe(2);
    expect(res.body.byDay[0].clicks).toBe(1);
  });

  it("campaign list carries page-level metric totals (one grouped query)", async () => {
    const res = await app.get("/admin/advertising/campaigns?status=ACTIVE&placement=HOME_HERO").set(auth(adminToken));
    expect(res.status).toBe(200);
    const row = res.body.data.find((c: any) => c.id === campaignA);
    expect(row).toBeDefined();
    expect(row.metrics).toEqual({ impressions: 2, clicks: 1 });
    expect(row.advertiser?.id ?? row.advertiserId).toBe(ADMIN_ID);
  });

  it("pause hides the campaign from serving; resume brings it back", async () => {
    const pause = await app.post(`/admin/advertising/campaigns/${campaignA}/transition`).set(auth(adminToken)).send({ action: "pause" });
    expect(pause.status).toBe(200);
    expect(pause.body.status).toBe("PAUSED");
    const hidden = await app.get("/advertising/placements/HOME_HERO");
    expect(hidden.body.items).toHaveLength(0);
    const resume = await app.post(`/admin/advertising/campaigns/${campaignA}/transition`).set(auth(adminToken)).send({ action: "resume" });
    expect(resume.status).toBe(200);
    expect(resume.body.status).toBe("ACTIVE");
    const back = await app.get("/advertising/placements/HOME_HERO");
    expect(back.body.items.map((i: any) => i.id)).toContain(campaignA);
  });

  it("activate without approval is illegal (409) and re-approval is illegal", async () => {
    const unapproved = await createCampaign({ ...BASE, placement: "HOME_RAIL_SECONDARY", name: "B" });
    expect(unapproved.status).toBe(201);
    const early = await app
      .post(`/admin/advertising/campaigns/${unapproved.body.id}/transition`)
      .set(auth(adminToken))
      .send({ action: "activate" });
    expect(early.status).toBe(409);

    const again = await app
      .post(`/admin/advertising/campaigns/${campaignA}/transition`)
      .set(auth(adminToken))
      .send({ action: "approve" });
    expect(again.status).toBe(409);
  });

  it("reject requires a reason and stores it as reviewNote", async () => {
    const res = await createCampaign({ ...BASE, placement: "HOME_RAIL_SECONDARY", name: "Rejectee" });
    const id = res.body.id;
    const noReason = await app.post(`/admin/advertising/campaigns/${id}/transition`).set(auth(adminToken)).send({ action: "reject" });
    expect(noReason.status).toBe(400);
    const rejected = await app
      .post(`/admin/advertising/campaigns/${id}/transition`)
      .set(auth(adminToken))
      .send({ action: "reject", reason: "Misleading cta" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.reviewStatus).toBe("REJECTED");
    expect(rejected.body.reviewNote).toBe("Misleading cta");
  });

  it("PATCH is only allowed while DRAFT | PAUSED | REJECTED (else 409)", async () => {
    const active = await app.patch(`/admin/advertising/campaigns/${campaignA}`).set(auth(adminToken)).send({ title: "New" });
    expect(active.status).toBe(409);

    // REJECTED campaigns are editable and editing re-opens the review.
    const list = await app.get("/admin/advertising/campaigns?reviewStatus=REJECTED").set(auth(adminToken));
    const rejectedId = list.body.data[0].id;
    const edited = await app.patch(`/admin/advertising/campaigns/${rejectedId}`).set(auth(adminToken)).send({ title: "Fixed cta" });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe("Fixed cta");
    expect(edited.body.reviewStatus).toBe("PENDING");
    expect(edited.body.reviewNote).toBeNull();
  });

  it("DELETE only removes DRAFT or REJECTED campaigns", async () => {
    const fresh = await createCampaign({ ...BASE, name: "Doomed" });
    const del = await app.delete(`/admin/advertising/campaigns/${fresh.body.id}`).set(auth(adminToken));
    expect(del.status).toBe(200);
    const gone = await db.orm.public.AdCampaign.where({ id: fresh.body.id }).first();
    expect(gone).toBeNull();

    const active = await app.delete(`/admin/advertising/campaigns/${campaignA}`).set(auth(adminToken));
    expect(active.status).toBe(409);
  });

  it("activate with a future startsAt schedules instead of activating", async () => {
    const res = await createCampaign({ ...BASE, placement: "SERVER_FEATURED", name: "Scheduled", startsAt: new Date(Date.now() + 3600_000).toISOString() });
    const id = res.body.id;
    await app.post(`/admin/advertising/campaigns/${id}/transition`).set(auth(adminToken)).send({ action: "approve" });
    const act = await app.post(`/admin/advertising/campaigns/${id}/transition`).set(auth(adminToken)).send({ action: "activate" });
    expect(act.status).toBe(200);
    expect(act.body.status).toBe("SCHEDULED");
    // Scheduled-but-not-started campaigns do not serve.
    const serving = await app.get("/advertising/placements/SERVER_FEATURED");
    expect(serving.body.items).toHaveLength(0);
  });

  it("activate with an already-ended window is a 409", async () => {
    const res = await createCampaign({ ...BASE, placement: "MARKET_FEATURED", name: "Too late", endsAt: new Date(Date.now() - 3600_000).toISOString() });
    const id = res.body.id;
    await app.post(`/admin/advertising/campaigns/${id}/transition`).set(auth(adminToken)).send({ action: "approve" });
    const act = await app.post(`/admin/advertising/campaigns/${id}/transition`).set(auth(adminToken)).send({ action: "activate" });
    expect(act.status).toBe(409);
  });

  it("events for non-servable campaigns are rejected (400 bad uuid, 404 not ACTIVE+APPROVED)", async () => {
    const draft = await createCampaign({ ...BASE, name: "Draft only" });
    const bad = await app.post("/advertising/events/impression").send({ campaignId: "not-a-uuid" });
    expect(bad.status).toBe(400);
    const draftEvent = await app.post("/advertising/events/impression").send({ campaignId: draft.body.id });
    expect(draftEvent.status).toBe(404);
    const unknown = await app
      .post("/advertising/events/click")
      .send({ campaignId: "550e8400-e29b-41d4-a716-446655447599" });
    expect(unknown.status).toBe(404);
  });

  it("expiry sweep marks window-passed campaigns EXPIRED and stops serving them", async () => {
    const res = await createCampaign({ ...BASE, name: "Expiring", endsAt: new Date(Date.now() + 1200).toISOString() });
    const id = res.body.id;
    await app.post(`/admin/advertising/campaigns/${id}/transition`).set(auth(adminToken)).send({ action: "approve" });
    const act = await app.post(`/admin/advertising/campaigns/${id}/transition`).set(auth(adminToken)).send({ action: "activate" });
    expect(act.status).toBe(200);
    expect(act.body.status).toBe("ACTIVE");

    await new Promise((resolve) => setTimeout(resolve, 1400));
    resetExpirySweepGuardForTests();
    const after = await app.get("/advertising/placements/HOME_HERO");
    expect(after.status).toBe(200);
    const row = (await db.orm.public.AdCampaign.where({ id }).first()) as any;
    expect(row.status).toBe("EXPIRED");
    // Events against the expired campaign are rejected.
    const ev = await app.post("/advertising/events/impression").send({ campaignId: id });
    expect(ev.status).toBe(404);
  });

  it("disabled feature flag removes the surface honestly (404 Not found)", async () => {
    process.env.FEATURE_ADVERTISING = "false";
    try {
      const placements = await app.get("/advertising/placements/HOME_HERO");
      expect(placements.status).toBe(404);
      expect(placements.body).toEqual({ error: "Not found" });
      const adminList = await app.get("/admin/advertising/campaigns").set(auth(adminToken));
      expect(adminList.status).toBe(404);
      const event = await app.post("/advertising/events/impression").send({ campaignId: campaignA });
      expect(event.status).toBe(404);
    } finally {
      process.env.FEATURE_ADVERTISING = "true";
    }
  });
});