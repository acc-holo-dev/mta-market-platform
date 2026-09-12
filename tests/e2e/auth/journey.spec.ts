// PLAN-001 final acceptance: the full product cycle in a real browser.
//
//   register -> login -> profile -> balance -> Marketplace -> resource detail
//   -> seller area -> create resource -> fill data -> artifact upload
//   -> "Завершить" -> PENDING_REVIEW -> admin login -> Admin Panel
//   -> moderation queue -> approve/reject -> PUBLISHED -> appears in
//   Marketplace -> buyer free/paid acquisition -> license -> purchases/account
//
// Plus the negative cases from the acceptance checklist. Runs against the
// real dev servers; see the development docs for the run recipe.
import { test, expect } from "@playwright/test";
import {
  API,
  RUN,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  makeArtifact,
  apiLogin,
  psql,
  uiRegister,
  uiLogin,
  cleanupEntities,
} from "../../tools/playwright/fixtures";

const PASSWORD = "e2e-user-password-123";

const BUYER = `e2e_buyer_${RUN}`;
const SELLER = `e2e_seller_${RUN}`;
const SELLER_NAME = "E2E Seller Studio";
const PAID_SLUG = `e2e-paid-resource-${RUN}`;
const PAID_TITLE = `E2E Paid Resource ${RUN}`;
const FREE_SLUG = `e2e-free-resource-${RUN}`;
const FREE_TITLE = `E2E Free Resource ${RUN}`;
// A SECOND free resource that is approved and used for the buyer acquisition
// test (the first free resource is intentionally rejected in moderation).
const FREEACQ_SLUG = `e2e-freeacq-${RUN}`;
const FREEACQ_TITLE = `E2E Free Acquisition ${RUN}`;

test.describe.serial("auth journey and full product cycle", () => {
  let adminToken = "";
  let sellerToken = "";

  test.beforeAll(async ({ request }) => {
    // The ADMIN account is created before the run: pnpm test:e2e:admin (G-004).
    adminToken = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(adminToken).toBeTruthy();
  });

  // PLAN-016 D-013 (PLAN-006 §17-18): remove the entities this run created
  // so repeated runs do not accumulate `e2e_*` rows — via the canonical
  // FK-safe cleanup (financialTransaction → purchase → order → … → user).
  // Resources cascade with the seller. e2e-admin is never touched.
  test.afterAll(async () => {
    try {
      await cleanupEntities({ usernames: [BUYER, SELLER, `e2e_login_${RUN}`] });
    } catch (e) {
      // Cleanup is hygiene, not an assertion — a failed cleanup must not
      // fail the run report.
      console.warn("[journey afterAll] cleanup skipped:", String(e).slice(0, 200));
    }
  });

  // ------------------------------------------------------------------
  // 1. Registration / login / profile / balance / session
  // ------------------------------------------------------------------
  test("register -> profile -> balance 0 -> edit profile -> session survives reload", async ({
    page,
  }) => {
    await uiRegister(page, BUYER);

    // Navbar shows the user and the persisted zero balance (C-003/C-004).
    await expect(page.getByText("0.00 ₽")).toBeVisible();

    // Profile page (B-001): username, email, balance.
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Профиль", level: 1 })).toBeVisible();
    await expect(page.getByText(BUYER).first()).toBeVisible();
    await expect(page.getByText(`${BUYER}@e2e.local`)).toBeVisible();
    await expect(page.getByText("0.00 ₽").first()).toBeVisible();

    // Balance is a real DB row (C-001/C-002), not frontend-only.
    const bal = await psql(
      `SELECT available FROM "userBalance" ub JOIN "user" u ON u.id = ub."userId" WHERE u.username = '${BUYER}'`
    );
    expect(bal).toBe("0");

    // Profile edit (B-002): displayName editable.
    await page.getByRole("button", { name: "Редактировать профиль" }).click();
    await page.getByPlaceholder("Как вас видят другие").fill("E2E Покупатель");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("E2E Покупатель").first()).toBeVisible();

    // Session survives a full page reload (bootstrap via refresh cookie).
    await page.reload();
    await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();
    await expect(page.getByText("E2E Покупатель").first()).toBeVisible();
  });

  test("logout -> login with username -> login with email", async ({ page }) => {
    await uiRegister(page, `e2e_login_${RUN}`);
    await page.getByRole("button", { name: "Выход" }).click();
    await expect(page.getByRole("link", { name: "Войти" })).toBeVisible();

    await uiLogin(page, `e2e_login_${RUN}`, PASSWORD);
    await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();

    await page.getByRole("button", { name: "Выход" }).click();
    await expect(page.getByRole("link", { name: "Войти" })).toBeVisible();
    await uiLogin(page, `e2e_login_${RUN}@e2e.local`, PASSWORD);
    await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();
  });

  test("duplicate username is rejected with a human-readable error", async ({ page }) => {
    await page.goto("/auth/register");
    await page.getByLabel("Имя пользователя").fill(BUYER); // already registered
    await page.getByLabel("Email").fill(`other_${RUN}@e2e.local`);
    await page.locator("#password").first().fill(PASSWORD);
    await page.locator("#confirmPassword").fill(PASSWORD);
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();
    // The page renders the server error in a <p role="alert">.
    await expect(page.getByText(/Username is already taken/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  // ------------------------------------------------------------------
  // 2. Seller onboarding through admin approval
  // ------------------------------------------------------------------
  test("seller applies -> admin approves in Admin Panel -> seller area opens", async ({
    page,
    request,
  }) => {
    await uiRegister(page, SELLER);
    await page.goto("/seller");
    await page.getByPlaceholder("Например: CoolScripts").fill(SELLER_NAME);
    await page.getByRole("button", { name: "Отправить заявку" }).click();
    await expect(page.getByText("Заявка на рассмотрении")).toBeVisible();

    sellerToken = await apiLogin(request, SELLER, PASSWORD);

    await uiLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Продавцы" }).click();

    // Approve every PENDING application, then expect the queue to empty.
    // (Previous E2E runs may leave their own PENDING rows behind; the queue
    // must be empty for THIS seller to proceed.)
    // Approve THIS run's seller. The row is identified by the userId shown
    // in the queue (sellerProfile.userId). The UI refetches after the action.
    const sellerUserId = await psql(`SELECT id FROM "user" WHERE username = '${SELLER}'`);
    const row = page.locator("div.border", { hasText: sellerUserId }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Одобрить" }).click();
    await expect(row).toHaveCount(0, { timeout: 20_000 });
    // Approve any leftovers from earlier runs so the queue is clean.
    const approveButtons = page.getByRole("button", { name: "Одобрить" });
    for (let i = 0; i < 10 && (await approveButtons.count()); i++) {
      await approveButtons.first().click();
      await page.waitForTimeout(1_500);
    }
    await expect(approveButtons).toHaveCount(0, { timeout: 20_000 });

    await uiLogin(page, SELLER, PASSWORD);
    await page.goto("/seller");
    await expect(page.getByText("Кабинет продавца")).toBeVisible();
  });

  // ------------------------------------------------------------------
  // 3. Resource creation wizard -> artifact upload -> PENDING_REVIEW
  // ------------------------------------------------------------------
  test("seller creates resource via wizard: data + artifact upload -> PENDING_REVIEW", async ({
    page,
  }) => {
    await uiLogin(page, SELLER, PASSWORD);
    await page.goto("/seller/new");

    // Step 1: basic info.
    await page.locator("#res-title").fill(PAID_TITLE);
    await page
      .locator("#res-desc")
      .fill("Автоматизированный E2E ресурс для приёмки PLAN-001, полный цикл.");
    await page.getByRole("button", { name: "Далее" }).click();

    // Step 2: type + price -> creates the DRAFT.
    await page.locator("#res-price").fill("20");
    await page.getByRole("button", { name: "Создать черновик" }).click();
    await expect(page.getByText(`Черновик «${PAID_TITLE}» создан`)).toBeVisible({
      timeout: 20_000,
    });

    // Step 3: real artifact upload through the file input.
    const artifact = makeArtifact(`paid-${RUN}.zip`, `paid-${RUN}`);
    await page.locator("#res-file").setInputFiles(artifact);
    // Upload runs on button click: multipart upload + signed version creation.
    await page.getByRole("button", { name: "Загрузить и продолжить" }).click();
    await expect(page.getByText(/Загружен: paid-/)).toBeVisible({ timeout: 20_000 });

    // Step 4 (PLAN-003): Presentation (оформление) — идём дальше без медиа.
    await page.getByRole("button", { name: "Далее" }).click();

    // Step 5 (PLAN-003): preview + "Завершить" -> submit for moderation.
    await page.getByRole("button", { name: "Завершить" }).click();
    await expect(page.getByText("Ресурс отправлен на модерацию")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("На модерации")).toBeVisible();

    // Seller sees the moderation status in the dashboard (E-002).
    await page.goto("/seller");
    const row = page.locator("div.border", { hasText: PAID_TITLE }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("На модерации")).toBeVisible();

    // DB state matches the UI.
    const status = await psql(`SELECT status FROM resource WHERE slug = '${PAID_SLUG}'`);
    expect(status).toBe("PENDING_REVIEW");
  });

  test("seller cannot self-publish and draft/pending resource is not public", async ({
    request,
    page,
  }) => {
    // Seller cannot publish (A-008 transition matrix).
    const res = await request.patch(`${API}/resources/${PAID_SLUG}`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      data: { status: "PUBLISHED" },
    });
    expect(res.status()).toBe(403);

    // Anonymous marketplace does not list it; direct URL 404s (D-004).
    await page.goto("/resources");
    await expect(page.getByText(PAID_TITLE)).toHaveCount(0);
    await page.goto(`/resources/${PAID_SLUG}`);
    await expect(page.getByText("Ресурс не найден")).toBeVisible();

    const pub = await request.get(`${API}/resources/${PAID_SLUG}`);
    expect(pub.status()).toBe(404);
  });

  // ------------------------------------------------------------------
  // 4. Admin Panel: moderation queue, approve -> PUBLISHED
  // ------------------------------------------------------------------
  test("admin sees queue and approves -> resource appears in Marketplace", async ({
    page,
  }) => {
    await uiLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin");

    // Moderation queue shows the submitted resource with metadata (F-001).
    const row = page.locator("div.border", { hasText: PAID_TITLE }).first();
    await expect(row).toBeVisible();
    // Moderation queue shows the submitted resource with metadata (F-001);
    // PLAN-003 K-005: человекочитаемый тип вместо raw enum.
    // Карточка в очереди теперь содержит и мета-строку «Скрипт · …», и
    // модальный product view — strict mode требует first().
    await expect(row.getByText("Скрипт").first()).toBeVisible();

    // Прошлые прогоны могут оставлять PENDING_REVIEW-ресурсы с тем же
    // title-паттерном — публикаем строго в строке текущего RUN.
    await row
      .getByRole("button", { name: "Опубликовать" })
      .first()
      .click();
    await expect(page.getByText("Очередь пуста.")).toBeVisible({ timeout: 20_000 });

    // Moderation event was recorded (F-005).
    const events = await psql(
      `SELECT count(*) FROM "moderationEvent" me JOIN resource r ON r.id = me."resourceId" WHERE r.slug = '${PAID_SLUG}' AND me."toStatus" = 'PUBLISHED'`
    );
    expect(events).toBe("1");

    // Marketplace now lists it (F-003), and the detail page works (D-003).
    await page.goto("/resources");
    await expect(page.getByText(PAID_TITLE)).toBeVisible();
    await page.getByText(PAID_TITLE).first().click();
    await expect(page.getByRole("heading", { name: PAID_TITLE })).toBeVisible();
    await expect(page.getByText("20.00 ₽").first()).toBeVisible();
    // PLAN-003 D-001: версия теперь показывается и в hero (бейдж), и в
    // таймлайне версий — strict mode требует first().
    await expect(page.getByText("v1.0.0").first()).toBeVisible();
  });

  test("admin rejects the free resource -> it is not published", async ({ page }) => {
    // Second resource (free) goes through the wizard and gets rejected.
    await uiLogin(page, SELLER, PASSWORD);
    await page.goto("/seller/new");
    await page.locator("#res-title").fill(FREE_TITLE);
    await page.locator("#res-desc").fill("Ресурс для проверки отклонения модерацией.");
    await page.getByRole("button", { name: "Далее" }).click();
    await page.locator("#res-price").fill("0");
    await page.getByRole("button", { name: "Создать черновик" }).click();
    const artifact = makeArtifact(`free-${RUN}.zip`, `free-${RUN}`);
    await page.locator("#res-file").setInputFiles(artifact);
    await page.getByRole("button", { name: "Загрузить и продолжить" }).click();
    // PLAN-003: шаг «Оформление» между файлом и отправкой.
    await page.getByRole("button", { name: "Далее" }).click();
    await page.getByRole("button", { name: "Завершить" }).click();
    await expect(page.getByText("Ресурс отправлен на модерацию")).toBeVisible();

    await uiLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin");
    const row = page.locator("div.border", { hasText: FREE_TITLE }).first();
    await expect(row).toBeVisible();
    await row.locator("input").fill("E2E reject: не проходит по критериям");
    await row.getByRole("button", { name: "Отклонить" }).first().click();
    await expect(page.getByText("Очередь пуста.")).toBeVisible({ timeout: 20_000 });

    // Reject does NOT publish: not in marketplace, not fetchable (F-004).
    await page.goto("/resources");
    await expect(page.getByText(FREE_TITLE)).toHaveCount(0);

    const status = await psql(`SELECT status FROM resource WHERE slug = '${FREE_SLUG}'`);
    expect(status).toBe("SUSPENDED");

    // Seller sees the outcome in the dashboard.
    await uiLogin(page, SELLER, PASSWORD);
    await page.goto("/seller");
    const sellerRow = page.locator("div.border", { hasText: FREE_TITLE }).first();
    await expect(sellerRow.getByText("Приостановлен")).toBeVisible();
  });

  // ------------------------------------------------------------------
  // 5. Role gates
  // ------------------------------------------------------------------
  test("USER is blocked from Admin Panel (UI) and API (403); ADMIN passes", async ({
    page,
    request,
  }) => {
    await uiLogin(page, BUYER, PASSWORD);

    // UI: access denied card, no admin UI.
    await page.goto("/admin");
    await expect(page.getByText("Доступ запрещён")).toBeVisible();

    // API: the backend rejects the normal user even without the UI.
    const buyerToken = await apiLogin(request, BUYER, PASSWORD);
    const asUser = await request.get(`${API}/admin/stats`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(asUser.status()).toBe(403);

    const asAdmin = await request.get(`${API}/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(asAdmin.status()).toBe(200);
  });

  // ------------------------------------------------------------------
  // 6. Buyer: free acquisition (no payment), paid purchase -> license
  // ------------------------------------------------------------------
  test("buyer acquires the free resource: license issued, no payment row", async ({
    page,
    request,
  }) => {
    // ---- Setup (API): seller publishes a second (approved) free resource ----
    const created = await request.post(`${API}/resources`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      data: {
        slug: FREEACQ_SLUG,
        title: FREEACQ_TITLE,
        description: "Ресурс для проверки бесплатного получения покупателем.",
        type: "SCRIPT",
        price: 0,
      },
    });
    expect(created.status()).toBe(201);
    const up = await request.post(`${API}/upload/resource`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      multipart: {
        file: makeArtifact(`freeacq-${RUN}.zip`, `freeacq-${RUN}`),
      },
    });
    expect(up.status()).toBe(201);
    const upBody = await up.json();
    const ver = await request.post(`${API}/resources/${FREEACQ_SLUG}/versions`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      data: {
        version: "1.0.0",
        changelog: "free acquisition",
        fileUrl: upBody.fileUrl,
        fileSize: upBody.fileSize,
        fileChecksum: upBody.fileChecksum,
      },
    });
    expect(ver.status()).toBe(201);
    const submit = await request.patch(`${API}/resources/${FREEACQ_SLUG}`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
      data: { status: "PENDING_REVIEW" },
    });
    expect(submit.status()).toBe(200);
    const freeResId = await psql(`SELECT id FROM resource WHERE slug = '${FREEACQ_SLUG}'`);
    const approve = await request.patch(`${API}/admin/resources/${freeResId}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: "PUBLISHED" },
    });
    expect(approve.status()).toBe(200);

    // ---- Buyer flow (browser): free acquisition ----
    await uiLogin(page, BUYER, PASSWORD);
    await page.goto(`/resources/${FREEACQ_SLUG}`);
    await expect(page.getByRole("heading", { name: FREEACQ_TITLE })).toBeVisible();

    await page.getByRole("button", { name: "Получить", exact: true }).click();
    await expect(page.getByText("Покупка завершена")).toBeVisible({ timeout: 20_000 });

    // Purchases/account (H-004): purchase + license visible.
    await page.goto("/account");
    const purchaseRow = page
      .locator("div.border.rounded-lg", { has: page.getByRole("link", { name: FREEACQ_TITLE }) })
      .first();
    await expect(purchaseRow).toBeVisible();
    await expect(purchaseRow.getByText("Завершена").first()).toBeVisible();
    await expect(purchaseRow.getByText("Активна").first()).toBeVisible();

    // INV-002: free acquisition must NOT create a payment row.
    const purchases = await psql(
      `SELECT count(*) FROM purchase pu JOIN "user" u ON u.id = pu."buyerId" JOIN resource r ON r.id = pu."resourceId" WHERE u.username = '${BUYER}' AND r.slug = '${FREEACQ_SLUG}'`
    );
    expect(purchases).toBe("1");
    const payments = await psql(
      `SELECT count(*) FROM payment p JOIN purchase pu ON pu.id = p."purchaseId" JOIN "user" u ON u.id = pu."buyerId" JOIN resource r ON r.id = pu."resourceId" WHERE u.username = '${BUYER}' AND r.slug = '${FREEACQ_SLUG}'`
    );
    expect(payments).toBe("0");
  });

  test("paid purchase creates purchase -> dev completion -> license ACTIVE in account", async ({
    page,
    request,
  }) => {
    await uiLogin(page, BUYER, PASSWORD);
    await page.goto(`/resources/${PAID_SLUG}`);
    await expect(page.getByRole("heading", { name: PAID_TITLE })).toBeVisible();

    await page.getByRole("button", { name: "Купить сейчас" }).click();

    // YooKassa is disabled in the acceptance env: the checkout stays pending
    // (with the dev TEST stub the crypto-invoice block may render next to it).
    await expect(page.getByText("Ожидает оплаты", { exact: true })).toBeVisible({ timeout: 20_000 });

    const purchaseId = await psql(
      `SELECT pu.id FROM purchase pu JOIN "user" u ON u.id = pu."buyerId" JOIN resource r ON r.id = pu."resourceId" WHERE u.username = '${BUYER}' AND r.slug = '${PAID_SLUG}'`
    );
    expect(purchaseId).toBeTruthy();

    // Development payment completion (documented dev path; YooKassa is off).
    const buyerToken = await apiLogin(request, BUYER, PASSWORD);
    const sim = await request.post(`${API}/payments/${purchaseId}/simulate`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(sim.status()).toBe(200);
    const simBody = await sim.json();
    expect(simBody.licenseId).toBeTruthy();

    // Account shows the completed purchase with an ACTIVE license.
    await page.goto("/account");
    const purchaseRow = page
      .locator("div.border.rounded-lg", { has: page.getByRole("link", { name: PAID_TITLE }) })
      .first();
    await expect(purchaseRow).toBeVisible({ timeout: 20_000 });
    await expect(purchaseRow.getByText("Завершена").first()).toBeVisible();
    await expect(purchaseRow.getByText("Активна").first()).toBeVisible();

    // DB: purchase COMPLETED + license ACTIVE persisted.
    const purchaseStatus = await psql(`SELECT status FROM purchase WHERE id = '${purchaseId}'`);
    expect(purchaseStatus).toBe("COMPLETED");
    const license = await psql(
      `SELECT status FROM license WHERE "purchaseId" = '${purchaseId}'`
    );
    expect(license).toBe("ACTIVE");
  });

  test("purchases dashboard lists the acquisitions", async ({ page }) => {
    await uiLogin(page, BUYER, PASSWORD);
    await page.goto("/dashboard");
    // PLAN-006: the dashboard also renders the «Сейчас» summary, whose rows
    // may mention the same resource title (detail text) — match the purchases
    // list rows via their links, not bare text.
    await expect(
      page.getByRole("link", { name: PAID_TITLE, exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: FREEACQ_TITLE, exact: true })
    ).toBeVisible();
    // The rejected free resource was never purchased and never appears.
    await expect(page.getByText(FREE_TITLE)).toHaveCount(0);
  });
});
