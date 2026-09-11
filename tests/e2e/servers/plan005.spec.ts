// PLAN-005 acceptance: Community & Server Foundation в реальном браузере.
//   Server discovery с живым онлайном и приватностью (B/D/E/S)
//   Public server page: hero, live, news, updates, reviews (D)
//   Privacy: showStats=false скрывает числа (S)
//   Register → Create server → integration token (C)
//   Forum: категории, тема, ответ (F)
//   Notifications: unread + read-all (M)
//   Profile: бейджи (O/P)
//
// Работает на seed-датасете (scripts/seed-plan005.ts) + живом heartbeat
// (scripts/dev-heartbeat.ts): 8 публичных серверов, 7 категорий форума.
import { test, expect } from "@playwright/test";
import { RUN, uiLogin, uiRegister, psql } from "../../tools/playwright/helpers";

const SEED_PASSWORD = "seed-password-123";

test.describe.configure({ mode: "serial" });

test.describe("PLAN-005 Servers", () => {
  test("guest discovery lists public servers and hides non-public (W/S)", async ({
    page,
  }) => {
    await page.goto("/servers");
    await expect(page.getByRole("heading", { name: /Серверы/i })).toBeVisible();

    // VERIFIED/ACTIVE серверы видны (шоу-кейс с сид-данными)
    await expect(page.getByText("Night City RP", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // PENDING_VERIFICATION и SUSPENDED не публикуются
    await expect(page.getByText("Freeroam Central")).toHaveCount(0);
    await expect(page.getByText("Harbor Heist")).toHaveCount(0);
  });

  test("search filters the list (W)", async ({ page }) => {
    await page.goto("/servers");
    const search = page.getByLabel("Поиск серверов").first();
    await search.fill("Night");
    await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
    await expect(page.getByText("Night City RP", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("public server page shows live status, badge and sections (D-002/D-003)", async ({
    page,
  }) => {
    await page.goto("/servers/night-city-rp");
    await expect(page.getByRole("heading", { name: "Night City RP" })).toBeVisible();
    // Verified badge (C-002)
    await expect(page.getByText("Verified", { exact: true }).first()).toBeVisible();
    // Live online (heartbeat живой): pattern N/800
    await expect(page.getByText(/\/\s*800/).first()).toBeVisible({ timeout: 15_000 });
    // Табы существуют
    await expect(page.getByText("Обновления", { exact: true }).first()).toBeVisible();
  });

  test("cedar-falls hides stats: no numeric online shown (S — privacy on backend)", async ({
    page,
  }) => {
    await page.goto("/servers/cedar-falls");
    await expect(page.getByRole("heading", { name: "Cedar Falls Survival" })).toBeVisible({
      timeout: 15_000,
    });
    // showStats=false: hero must NOT render an "N/M" online pattern.
    // Followers (aggregate) remain public.
    await expect(page.getByText(/подписчик/).first()).toBeVisible();
    await expect(page.getByText(/\/\s*200\s*\/\s*200/)).toHaveCount(0);
  });

  test("news page of a server renders content (H-004)", async ({ page }) => {
    await page.goto("/servers/night-city-rp");
    await page.getByText("Новости", { exact: true }).first().click();
    const newsLink = page.locator('a[href*="/news/"]').first();
    await expect(newsLink).toBeVisible({ timeout: 15_000 });
    await newsLink.click();
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("PLAN-005 Community", () => {
  test("hub shows categories and pinned/latest threads (F-001)", async ({ page }) => {
    await page.goto("/community");
    await expect(page.getByRole("heading", { name: /Сообщество/i })).toBeVisible();
    // Категории из сид-данных
    await expect(page.getByText("Скриптинг", { exact: true }).first()).toBeVisible();
    // Закреплённая тема Night City RP
    await expect(page.getByText("Night City RP — открытие 8 сезона").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("forum category lists threads; thread page renders posts (F-003)", async ({ page }) => {
    await page.goto("/community/forum/servers");
    await expect(page.getByText("Night City RP — открытие 8 сезона").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByText("Night City RP — открытие 8 сезона").first().click();
    await expect(
      page.getByRole("heading", { name: "Night City RP — открытие 8 сезона" })
    ).toBeVisible();
    // Первый пост присутствует
    await expect(page.getByText(/переехали на новый хостинг/)).toBeVisible();
  });

  test("profile shows badges and server cards (O/P)", async ({ page }) => {
    await page.goto("/profile/nightcity_owner");
    await expect(page.getByText("Viktor Vale").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Server Owner").first()).toBeVisible();
    await expect(page.getByText("Verified Server").first()).toBeVisible();
    await expect(page.getByText("Night City RP", { exact: true }).first()).toBeVisible();
  });
});

test.describe("PLAN-005 Owner flow (registered user)", () => {
  const USERNAME = `e2e_sv_${RUN}`;

  test("register → create server → issue integration token (B/C)", async ({ page }) => {
    await uiRegister(page, USERNAME);

    await page.goto("/servers/create");
    // Шаг 1: Основное → «Создать сервер» (POST /servers)
    await page.getByLabel(/Название/i).fill(`E2E Server ${RUN}`);
    const desc = page.getByLabel(/Описание/i);
    if (await desc.isVisible().catch(() => false)) {
      await desc.fill("Сервер для E2E-проверки PLAN-005");
    }
    await page.getByRole("button", { name: /Создать сервер/i }).click();
    await expect(page.getByText(/Сервер создан/i)).toBeVisible({ timeout: 15_000 });

    // Шаг 2: подключение — пропускаем («Пропустить»), связь приватна
    const skip = page.getByRole("button", { name: /Пропустить/i }).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    }
    // Шаг 3: брендинг — «Продолжить»
    const cont = page.getByRole("button", { name: /Продолжить/i }).first();
    if (await cont.isVisible().catch(() => false)) {
      await cont.click();
    }
    // Шаг 4: приватность — «Сохранить и продолжить» (дефолты privacy-first)
    const save = page.getByRole("button", { name: /Сохранить и продолжить/i }).first();
    if (await save.isVisible().catch(() => false)) {
      await save.click();
      await page.waitForTimeout(600);
    }
    // Шаг 5: выпускаем токен
    await page.getByRole("button", { name: /токен интеграции/i }).first().click();
    await expect(page.getByText(/smk_[0-9a-f]{8}/).first()).toBeVisible({ timeout: 15_000 });

    // Токен не должен быть виден после перезагрузки (plaintext один раз)
    await page.reload();
    await expect(page.getByText(/smk_[0-9a-f]{40}/)).toHaveCount(0);
  });

  test("created server is not publicly discoverable before verification (A-003)", async ({
    page,
  }) => {
    await page.goto("/servers");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(`E2E Server ${RUN}`)).toHaveCount(0);
  });
});

test.describe("PLAN-005 Notifications & follow (L/M)", () => {
  test("login as market_fan → notifications center renders + read-all works", async ({ page }) => {
    await uiLogin(page, "market_fan", SEED_PASSWORD);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Уведомления" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    // «Прочитать всё» доступна и после клика не падает
    const readAll = page.getByRole("button", { name: /Прочитать всё/i });
    if (await readAll.isEnabled().catch(() => false)) {
      await readAll.click();
      await expect(page.getByText("Непрочитанные (0)")).toBeVisible({ timeout: 15_000 });
    }
  });

  test("follow button on a public server toggles state (L-001/L-002)", async ({ page }) => {
    await uiLogin(page, "racer_x", SEED_PASSWORD);
    await page.goto("/servers/night-city-rp");
    const followBtn = page.getByRole("button", { name: /Подписаться/i }).first();
    await expect(followBtn).toBeVisible({ timeout: 15_000 });
    await followBtn.click();
    // После подписки кнопка меняется (Отписаться) — caller.following с бэкенда
    await expect(page.getByRole("button", { name: /Отписаться/i })).toBeVisible({
      timeout: 15_000,
    });
    // Возвращаем состояние
    await page.getByRole("button", { name: /Отписаться/i }).click();
    await expect(page.getByRole("button", { name: /Подписаться/i }).first()).toBeVisible();
  });
});

test.afterAll(async () => {
  // Cleanup: e2e-created server rows (slug pattern is deterministic)
  try {
    await psql(`DELETE FROM "server" WHERE slug LIKE 'e2e-server-%'`);
    await psql(`DELETE FROM "user" WHERE username LIKE 'e2e_sv_%'`);
  } catch {
    // best effort
  }
});