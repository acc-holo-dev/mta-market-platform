// PLAN-006 acceptance (§19–§20): Daily Experience в реальном браузере.
//   Guest Home: live line, активность с deep links, «Популярное» (§19)
//   Activity item deep link → реальная сущность (§43)
//   Server Owner публикует новость → она появляется в Home-активности (§23-3)
//   Dashboard «Сейчас / За ночь»: сводка + продвижение baseline (§20)
//   Mobile smoke (§19)
//
// Работает на seed-датасете (scripts/seed-plan005.ts) + живом heartbeat
// (scripts/dev-heartbeat.ts). Мутации — через реальный API (не ORM), чтобы
// проверять продукт, а не схемы данных.
import { test, expect } from "@playwright/test";
import { API, RUN, uiLogin, apiLogin, psql } from "../../tools/playwright/helpers";

const SEED_PASSWORD = "seed-password-123";

test.describe.configure({ mode: "serial" });

async function apiRegister(request: import("@playwright/test").APIRequestContext, username: string) {
  const res = await request.post(`${API}/auth/register`, {
    data: { username, email: `${username}@e2e.local`, password: "e2e-user-password-123" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).accessToken as string;
}

test.describe("PLAN-006 Daily Experience", () => {
  test("guest home answers «что происходит прямо сейчас» (§19/§2)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Что происходит в MTA/i })).toBeVisible();

    // Live line: честные агрегаты (heartbeat держит seed-серверы онлайн).
    await expect(page.getByText(/игроков онлайн/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/серверов онлайн/)).toBeVisible();
    const liveText = await page.getByText(/игроков онлайн/).first().innerText();
    const players = parseInt(liveText.replace(/\D/g, ""), 10);
    expect(players).toBeGreaterThan(0);

    // Активность: лента высокоценных событий.
    await expect(page.getByRole("heading", { name: "Активность" })).toBeVisible();
    await expect(page.locator('section:has(h2:text("Активность")) a[href^="/"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // Популярное: топ серверов по реальному онлайну.
    await expect(page.getByRole("heading", { name: "Популярное", exact: true })).toBeVisible();
    await expect(page.getByText("Night City RP").first()).toBeVisible();
  });

  test("activity item deep-links to a real entity (§43)", async ({ page }) => {
    await page.goto("/");
    const firstItem = page
      .locator('section:has(h2:text("Активность")) a[href^="/"]')
      .first();
    await firstItem.waitFor({ timeout: 15_000 });
    const href = await firstItem.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toMatch(/^\/(servers|resources|community)\//);
    await firstItem.click();
    await page.waitForURL(`**${href}`, { timeout: 15_000 });
    expect(page.url()).toContain(href!);
  });

  test("owner publishes news → it appears in Home activity (§23-3)", async ({ page }) => {
    const ownerName = await psql(
      `SELECT u.username FROM "server" s JOIN "user" u ON u.id = s."ownerId" WHERE s.slug = 'night-city-rp'`
    );
    expect(ownerName).toBeTruthy();
    const token = await apiLogin(page.request, ownerName, SEED_PASSWORD);
    const title = `E2E Live News ${RUN}`;
    const createRes = await page.request.post(`${API}/servers/night-city-rp/news`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, content: "Новость для PLAN-006 E2E." },
    });
    expect(createRes.status()).toBe(201);
    const newsId = (await createRes.json()).id as string;
    const publishRes = await page.request.post(
      `${API}/servers/night-city-rp/news/${newsId}/publish`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(publishRes.status()).toBe(200);

    await page.goto("/");
    await expect(
      page.locator('section:has(h2:text("Активность"))').getByText(`Night City RP: ${title}`)
    ).toBeVisible({ timeout: 20_000 });
  });

  test("dashboard shows «Сейчас / За ночь» and advances the baseline (§20)", async ({ page }) => {
    const followerName = await psql(
      `SELECT u.username FROM "serverFollow" f JOIN "user" u ON u.id = f."userId" LIMIT 1`
    );
    expect(followerName).toBeTruthy();
    await uiLogin(page, followerName, SEED_PASSWORD);
    await page.goto("/dashboard");
    await expect(page.getByText("Сейчас", { exact: true })).toBeVisible({ timeout: 15_000 });
    const firstVisitText = await page
      .locator("text=/24 часа|прошлого визита/")
      .first()
      .innerText();

    // Повторный визит: сводка считается от прошлого dashboardSeenAt.
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(page.locator("text=/С вашего прошлого визита/").first()).toBeVisible({
      timeout: 15_000,
    });
    expect(firstVisitText).toBeTruthy();
  });

  test("mobile home keeps the daily experience usable (§19/L)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByText(/игроков онлайн/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Активность" })).toBeVisible();
    await expect(
      page.locator('section:has(h2:text("Активность")) a[href^="/"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
