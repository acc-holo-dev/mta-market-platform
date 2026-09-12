// PLAN-016 acceptance (§14 DoD): глобальный shell в реальном браузере.
//   Sidebar expanded/collapsed + персистентность (PLAN-015 §6)
//   Theme toggle + персистентность (PLAN-015 §10)
//   Global search dropdown: keyboard, empty/error states (PLAN-015 §8)
//   AccountMenu + баланс без dashboard (PLAN-015 §7/§33)
//   Статистика сервера 24H/7D/30D (PLAN-016 D-007)
//   Login page: discovery-кнопки только включённых провайдеров (PLAN-016 A-001)
//   «/»-хоткей поиска (PLAN-015 §8)
//   Checkout: выбор способа оплаты + crypto-invoice блок (PLAN-016 P-005)
//   Страница /account/identities (PLAN-016 A-006)
//
// Работает на seed-датасете (scripts/seed-plan005.ts + dev-heartbeat).
import { test, expect, type Page } from "@playwright/test";
import {
  API,
  RUN,
  uiRegister,
  uiLogin,
  apiLogin,
  psql,
  cleanupEntities,
} from "../../tools/playwright/fixtures";

const PASSWORD = "e2e-user-password-123";
const SHELL_USER = `e2e_shell_${RUN}`;
// Published paid resource from the plan-003 seed (stable slug).
const PAID_SLUG = "scoreboard-pro";

test.describe.configure({ mode: "serial" });

function isDark(page: Page) {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}

test.describe("global shell and checkout acceptance", () => {
  // PLAN-016 D-013 hygiene: the run-created user (and its purchases) must
  // not accumulate across runs — canonical FK-safe cleanup (RESTRICT
  // children first, user last). e2e-admin is never touched.
  test.afterAll(async () => {
    try {
      await cleanupEntities({ usernames: [SHELL_USER] });
    } catch (e) {
      console.warn("[shell afterAll] cleanup skipped:", String(e).slice(0, 200));
    }
  });
  test("sidebar collapses and persists state across reload (PLAN-015 §6)", async ({ page }) => {
    await page.goto("/");
    // Collapsed state is visible via the toggle label.
    const collapseButton = page.getByRole("button", { name: "Свернуть меню" });
    const expandButton = page.getByRole("button", { name: "Развернуть меню" });

    // Desktop viewport (1280×720): sidebar starts expanded.
    await expect(collapseButton).toBeVisible({ timeout: 15_000 });
    await collapseButton.click();
    await expect(expandButton).toBeVisible();

    // Reload: state persists via localStorage.
    await page.reload();
    await expect(page.getByRole("button", { name: "Развернуть меню" })).toBeVisible();

    // Restore the expanded state for later serial tests.
    await page.getByRole("button", { name: "Развернуть меню" }).click();
    await expect(page.getByRole("button", { name: "Свернуть меню" })).toBeVisible();
  });

  test("theme toggle switches html.dark and persists the preference (PLAN-015 §10)", async ({
    page,
  }) => {
    await page.goto("/");
    const before = await isDark(page);
    await page.getByRole("button", { name: /Включить светлую тему|Включить тёмную тему/ }).click();
    await expect.poll(() => isDark(page)).toBe(!before);
    // Persists across reload (no-FOUC init script in layout.tsx).
    await page.reload();
    expect(await isDark(page)).toBe(!before);
    // Restore the baseline for later tests.
    await page.getByRole("button", { name: /Включить светлую тему|Включить тёмную тему/ }).click();
    expect(await isDark(page)).toBe(before);
  });

  test("global search dropdown shows the honest empty state and closes (PLAN-015 §8)", async ({
    page,
  }) => {
    await page.goto("/");
    const input = page.getByRole("combobox", { name: "Глобальный поиск по платформе" });
    await input.click();
    await input.fill("запросбезрезультатовxyz");
    await expect(page.getByText(/ничего не найдено/i)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
  });

  test("account menu shows balance and logout without entering a dashboard", async ({ page }) => {
    await uiRegister(page, SHELL_USER);
    await page.getByRole("button", { name: "Меню аккаунта" }).click();
    // §33: баланс виден без входа в dashboard.
    await expect(page.getByText("Баланс", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("«/» hotkey focuses the global search (PLAN-015 §8)", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("/");
    await expect(
      page.getByRole("combobox", { name: "Глобальный поиск по платформе" })
    ).toBeFocused();
    await page.keyboard.press("Escape");
  });

  test("/account/identities renders the connections management page (PLAN-016 A-006)", async ({
    page,
  }) => {
    await uiLogin(page, SHELL_USER, PASSWORD);
    await page.goto("/account/identities");
    await expect(page.getByRole("heading", { name: "Подключения" })).toBeVisible({ timeout: 15_000 });
    // The linked-identities card is present; with none linked the honest
    // empty state explains the rule (last login method stays).
    await expect(page.getByText("Привязанные способы входа")).toBeVisible();
    await expect(page.getByText(/Внешние способы входа не привязаны/)).toBeVisible();
    // Unlink actions exist only when something is linked.
    await expect(page.getByRole("button", { name: /Отвязать/ })).toHaveCount(0);
  });

  test("checkout: payment method selection and the crypto invoice block (PLAN-016 P-005)", async ({
    page,
    request,
  }) => {
    await uiLogin(page, SHELL_USER, PASSWORD);

    const providersRes = await page.request.get(`${API}/payments/providers`);
    const providersBody = (await providersRes.json()) as {
      providers: { provider: string; displayName: string; confirmation: string }[];
    };
    await page.goto(`/resources/${PAID_SLUG}`);
    await expect(
      page.getByRole("heading", { name: "Scoreboard Pro" })
    ).toBeVisible({ timeout: 15_000 });

    if (providersBody.providers.length === 0) {
      // Honest absence: without a configured provider there is no radio and
      // no invoice surface (same doctrine as the login buttons test).
      await expect(page.getByRole("group", { name: "Способ оплаты" })).toHaveCount(0);
      return;
    }

    // Method selection (PLAN-016 P-005): enabled providers only.
    const group = page.getByRole("group", { name: "Способ оплаты" });
    await expect(group).toBeVisible();
    await group.getByRole("radio", { name: /Оплата через/ }).first().check();

    await page.getByRole("button", { name: "Купить сейчас" }).click();
    await expect(page.getByText("Ожидает оплаты", { exact: true })).toBeVisible({ timeout: 20_000 });

    const isInvoice = providersBody.providers.some((p) => p.confirmation === "crypto_invoice");
    if (isInvoice) {
      // Invoice surface: memo, copy affordance, live TTL countdown.
      await expect(page.getByText("Комментарий к платежу")).toBeVisible();
      await expect(page.getByRole("button", { name: /Скопировать/ })).toBeVisible();
      await expect(page.getByText(/Инвойс действует ещё/)).toBeVisible();
    }

    // Dev completion through the documented simulate path; the invoice
    // surface flips to «Покупка завершена» by itself (polling, P-005) —
    // no manual reload, no admin button.
    const purchaseId = await psql(
      `SELECT pu.id FROM purchase pu JOIN "user" u ON u.id = pu."buyerId" JOIN resource r ON r.id = pu."resourceId" WHERE u.username = '${SHELL_USER}' AND r.slug = '${PAID_SLUG}'`
    );
    expect(purchaseId).toBeTruthy();
    const buyerToken = await apiLogin(request, SHELL_USER, PASSWORD);
    const sim = await request.post(`${API}/payments/${purchaseId}/simulate`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(sim.status()).toBe(200);

    await expect(page.getByText("Покупка завершена")).toBeVisible({ timeout: 30_000 });
  });

  test("login page renders discovery-driven buttons honestly (PLAN-016 A-001)", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    // The form itself remains usable (core E2E path).
    await expect(page.getByLabel("Имя пользователя или email")).toBeVisible();
    // PLAN-016 A-001: only ENABLED providers render buttons. In the test
    // environment no OAuth provider is configured — the block stays absent
    // (честное поведение, no dead buttons).
    const res = await page.request.get(`${API}/auth/providers`);
    const body = (await res.json()) as { providers: { provider: string }[] };
    if (body.providers.length > 0) {
      await expect(page.getByLabel("Вход через внешние сервисы")).toBeVisible();
    }
  });

  test("server statistics switch between 24H/7D/30D windows (PLAN-016 D-007)", async ({
    page,
  }) => {
    await page.goto("/servers/night-city-rp");
    // Hash-tabs use role=button with exact names (E2E contract).
    const liveTab = page.getByRole("button", { name: "Live" });
    await expect(liveTab).toBeVisible({ timeout: 15_000 });
    await liveTab.click();
    // PLAN-016 D-007: переключатель окна.
    const group = page.getByRole("group", { name: "Окно статистики" });
    await expect(group).toBeVisible({ timeout: 15_000 });
    await group.getByRole("button", { name: "7D" }).click();
    await expect(page.getByRole("heading", { name: "Онлайн за 7D" })).toBeVisible();
  });
});