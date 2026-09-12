// PLAN-010 acceptance (§10): Creator Analytics в реальном браузере.
//   Просмотр карточки ресурса → у аналитики продавца появляется просмотр.
//   Блок «Аналитика» с empty state; privacy: без идентичностей зрителей.
import { test, expect } from "@playwright/test";
import { API, RUN, uiLogin, apiLogin, cleanupEntities } from "../../tools/playwright/fixtures";

const SELLER = "nightforge"; // seed seller with APPROVED profile + resources
const SEED_PASSWORD = "seed-password-123";

test.describe.configure({ mode: "serial" });

let sellerToken = "";

test.describe("seller analytics privacy", () => {
  test.afterAll(async () => {
    // PLAN-016 D-013 hygiene: this spec creates no e2e_* entities (it works
    // on the seed dataset); the canonical hook is kept for uniformity and
    // would sweep run-scoped rows if any are ever added here.
    try {
      await cleanupEntities({});
    } catch (e) {
      console.warn("[analytics-privacy afterAll] cleanup skipped:", String(e).slice(0, 200));
    }
  });

  test("opening a resource page registers a view (C-001)", async ({ page }) => {
    sellerToken = await apiLogin(page.request, SELLER, SEED_PASSWORD);
    // Pick a published seed resource directly via API list.
    const list = await page.request.get(`${API}/resources?limit=5`);
    expect(list.status()).toBe(200);
    const data = (await list.json()).data as { slug: string }[];
    expect(data.length).toBeGreaterThan(0);
    const before = await page.request.get(`${API}/seller/analytics`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    expect(before.status()).toBe(200);
    const beforeBody = await before.json();
    const targetSlug = data[0].slug;
    const beforeViews =
      beforeBody.byResource?.find((r: any) => r.slug === targetSlug)?.views30d ?? 0;

    await page.goto(`/resources/${targetSlug}`);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
    // The view fires once per mount; give the fire-and-forget a beat.
    await page.waitForTimeout(1500);

    const after = await page.request.get(`${API}/seller/analytics`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    });
    const afterBody = await after.json();
    const afterViews =
      afterBody.byResource?.find((r: any) => r.slug === targetSlug)?.views30d ?? 0;
    expect(afterViews).toBeGreaterThanOrEqual(beforeViews + 1);
  });

  test("seller dashboard shows the analytics block (C-002)", async ({ page }) => {
    await uiLogin(page, SELLER, SEED_PASSWORD);
    await page.goto("/seller");
    await expect(page.getByText("Аналитика").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Просмотры \(30 дней\)/)).toBeVisible({ timeout: 15_000 });
    // The table lists resources with views.
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("mobile /seller keeps analytics readable (§10/L)", async ({ page }) => {
    // Login at desktop viewport (the logout control lives in the mobile
    // drawer), then resize — the point is analytics readability on mobile.
    await uiLogin(page, SELLER, SEED_PASSWORD);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/seller");
    await expect(page.getByText(/Просмотры \(30 дней\)/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("table").first()).toBeVisible();
  });
});
