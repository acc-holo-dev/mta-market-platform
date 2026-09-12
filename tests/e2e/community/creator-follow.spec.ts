// PLAN-008 acceptance (§14): Follow Expansion в реальном браузере.
//   Fan follows creator on storefront → creator publishes → notification.
//   Fan follows a resource → new version released → RESOURCE_UPDATE.
//   Creator publishes article → CREATOR_ARTICLE notification.
//
// Seller mutations go through the real API pipeline (artifact upload →
// version → re-moderation → admin approve). The follower flow goes through
// the real UI (follow buttons, notification center).
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  API,
  RUN,
  uiLogin,
  apiLogin,
  psql,
  makeArtifact,
  apiRegister,
  cleanupEntities,
} from "../../tools/playwright/fixtures";

const SELLER = "nightforge"; // seed seller with APPROVED profile
const SEED_PASSWORD = "seed-password-123";
const FAN_PASSWORD = "e2e-user-password-123";
const FAN = `e2e_fan_${RUN}`;
const ADMIN_EMAIL = "e2e-admin@mtamarket.local";
const ADMIN_PASSWORD = "e2e-admin-password-123";

test.describe.configure({ mode: "serial" });

let fanToken = "";
let sellerToken = "";
let adminToken = "";
let releaseSlug = ""; // created+published in test 2, reused in test 3
let createdArticleId = ""; // CREATOR_ARTICLE fixture (test 4)

/** Spec-local registration returning the bare token (canonical apiRegister). */
async function registerFan(request: APIRequestContext, username: string): Promise<string> {
  const { token } = await apiRegister(request, username, { password: FAN_PASSWORD });
  return token;
}

/** Real artifact pipeline: upload → version (CANDIDATE, signed). */
async function addVersion(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
  version: string,
  changelog: string
) {
  const upload = await request.post(`${API}/upload/resource`, {
    headers: { Authorization: `Bearer ${sellerToken}` },
    multipart: {
      file: makeArtifact(`${slug}-${version}.zip`, changelog),
    },
  });
  expect(upload.status()).toBe(201);
  const fileUrl = (await upload.json()).fileUrl as string;
  const versionRes = await request.post(`${API}/resources/${slug}/versions`, {
    headers: { Authorization: `Bearer ${sellerToken}` },
    data: {
      version,
      changelog,
      fileUrl,
      fileSize: 100,
      fileChecksum: `chk-${version}-${RUN}`,
    },
  });
  expect([200, 201]).toContain(versionRes.status());
}

/** Bring the resource into review and approve it: a fresh draft needs the
 * seller submit (DRAFT → PENDING_REVIEW); a version upload on a published
 * resource auto-returns it to PENDING_REVIEW (PLAN-008 D-002 path). */
async function releaseResource(request: import("@playwright/test").APIRequestContext, slug: string) {
  const status = await psql(`SELECT status FROM resource WHERE slug = '${slug}'`);
  if (status === "DRAFT") {
    const submit = await request.patch(`${API}/resources/${slug}`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      data: { status: "PENDING_REVIEW" },
    });
    expect(submit.status()).toBe(200);
  }
  const res = await psql(`SELECT id FROM resource WHERE slug = '${slug}'`);
  const approve = await request.patch(`${API}/admin/resources/${res}/status`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { status: "PUBLISHED" },
  });
  expect(approve.status()).toBe(200);
}

test.describe("creator follow notifications", () => {
  test.afterAll(async () => {
    // PLAN-016 D-013 hygiene: the fan user, the followed release (owned by
    // the seed seller — deleted explicitly) and the creator article.
    try {
      await cleanupEntities({
        usernames: [FAN],
        resources: releaseSlug ? [releaseSlug] : [],
        articles: createdArticleId ? [createdArticleId] : [],
      });
    } catch (e) {
      console.warn("[creator-follow afterAll] cleanup skipped:", String(e).slice(0, 200));
    }
  });

  test("fan follows the creator on the storefront (E-001)", async ({ page }) => {
    fanToken = await registerFan(page.request, FAN);
    sellerToken = await apiLogin(page.request, SELLER, SEED_PASSWORD);
    adminToken = await apiLogin(page.request, ADMIN_EMAIL, ADMIN_PASSWORD);

    await uiLogin(page, FAN, FAN_PASSWORD);
    await page.goto(`/sellers/${SELLER}`);
    const before = await page.getByText(/подписчиков/).first().innerText();
    await page.getByRole("button", { name: "Подписаться" }).click();
    await expect(page.getByRole("button", { name: "Отписаться" })).toBeVisible({ timeout: 15_000 });
    const after = await page.getByText(/подписчиков/).first().innerText();
    const extract = (t: string) => parseInt(t.replace(/\D/g, ""), 10) || 0;
    expect(extract(after)).toBe(extract(before) + 1);
  });

  test("creator publishes a resource → fan gets CREATOR_RESOURCE (D-001)", async ({ page }) => {
    releaseSlug = `e2e-follow-${RUN}`;
    const created = await page.request.post(`${API}/resources`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      data: {
        slug: releaseSlug,
        title: `E2E Followed Release ${RUN}`,
        description: "Ресурс, о котором подписчик узнает по уведомлению.",
        type: "SCRIPT",
        price: 0,
      },
    });
    expect(created.status()).toBe(201);
    await addVersion(page.request, releaseSlug, "1.0.0", "Первый релиз.");
    await releaseResource(page.request, releaseSlug);

    await uiLogin(page, FAN, FAN_PASSWORD);
    await page.goto("/notifications");
    await expect(page.getByText(/Новинка от/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/E2E Followed Release/).first()).toBeVisible({ timeout: 20_000 });
  });

  test("fan follows a resource → new version → RESOURCE_UPDATE (D-002)", async ({ page }) => {
    await uiLogin(page, FAN, FAN_PASSWORD);
    await page.goto(`/resources/${releaseSlug}`);
    await page.getByRole("button", { name: "Следить" }).click();
    await expect(page.getByRole("button", { name: "Не следить" })).toBeVisible({ timeout: 15_000 });

    await addVersion(page.request, releaseSlug, "1.1.0", `Обновление ${RUN}.`);
    await releaseResource(page.request, releaseSlug);

    await page.goto("/notifications");
    await expect(
      page.getByText(/новая версия 1\.1\.0/, { exact: false }).first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test("creator publishes an article → fan gets CREATOR_ARTICLE (D-003)", async ({ page }) => {
    const title = `E2E Followed Article ${RUN}`;
    const created = await page.request.post(`${API}/content`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      data: {
        title,
        content:
          "Материал для подписчиков создателя.\n\nУведомление CREATOR_ARTICLE должно прийти каждому подписчику.",
        category: "GUIDES",
      },
    });
    expect(created.status()).toBe(201);
    createdArticleId = (await created.json()).id;
    await page.request.post(`${API}/content/${createdArticleId}/submit`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    const approve = await page.request.post(`${API}/admin/content/${createdArticleId}/approve`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(approve.status()).toBe(200);

    await uiLogin(page, FAN, FAN_PASSWORD);
    await page.goto("/notifications");
    await expect(
      page.getByText(/Новая статья от автора: /, { exact: false }).first()
    ).toBeVisible({ timeout: 20_000 });
  });

  test("mobile storefront keeps the follow button usable (§14/L)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/sellers/${SELLER}`);
    await expect(page.getByRole("button", { name: /Подписаться|Отписаться/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});
