// PLAN-007 acceptance (§14): Content Foundation в реальном браузере.
//   Guest: хаб /content, статья, поиск (§19-подобные проверки)
//   Автор: создать → отправить → админ одобряет → Home-активность → страница
//   Reject-ветка: причина отказа видна автору в «Моих статьях»
//   Mobile smoke
//
// Мутации — через реальный API; админ-аккаунт создаётся pnpm test:e2e:admin.
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  API,
  RUN,
  uiLogin,
  apiLogin,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  apiRegister,
  cleanupEntities,
} from "../../tools/playwright/fixtures";

const AUTHOR = `e2e_ct_author_${RUN}`;
const PASSWORD = "e2e-user-password-123";

test.describe.configure({ mode: "serial" });

/** Spec-local registration returning the bare token (canonical apiRegister). */
async function registerAuthor(request: APIRequestContext, username: string): Promise<string> {
  const { token } = await apiRegister(request, username, { password: PASSWORD });
  return token;
}

const TITLE = `E2E Content Guide ${RUN}`;
const CONTENT =
  "Пошаговый разбор для владельцев серверов.\n\nВторая абзац проверяет рендер абзацев без HTML.\n\nТретий абзац ведёт к обсуждению.";

test.describe("content articles foundation", () => {
  let authorToken = "";
  let articleId = "";
  let slug = "";

  test.afterAll(async () => {
    // PLAN-016 D-013 hygiene: the author users go last — their articles,
    // the discussion thread and its posts cascade with them.
    try {
      await cleanupEntities({
        usernames: [AUTHOR, `e2e_ct_rj_${RUN}`],
        articles: articleId ? [articleId] : [],
      });
    } catch (e) {
      console.warn("[articles afterAll] cleanup skipped:", String(e).slice(0, 200));
    }
  });

  test("author → moderation → Home activity → article page (§14/§17-2)", async ({ page }) => {
    authorToken = await registerAuthor(page.request, AUTHOR);
    const created = await page.request.post(`${API}/content`, {
      headers: { Authorization: `Bearer ${authorToken}` },
      data: { title: TITLE, content: CONTENT, category: "GUIDES", tags: "e2e, guide" },
    });
    expect(created.status()).toBe(201);
    articleId = (await created.json()).id;
    slug = (await created.json()).slug;

    const submitted = await page.request.post(`${API}/content/${articleId}/submit`, {
      headers: { Authorization: `Bearer ${authorToken}` },
    });
    expect(submitted.status()).toBe(200);

    const adminToken = await apiLogin(page.request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const approved = await page.request.post(`${API}/admin/content/${articleId}/approve`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(approved.status()).toBe(200);

    // Open the article discussion (author action) and reply via forum API.
    const thread = await page.request.post(`${API}/content/${articleId}/discussion`, {
      headers: { Authorization: `Bearer ${authorToken}` },
    });
    expect(thread.status()).toBe(201);
    const threadId = (await thread.json()).id;
    const reply = await page.request.post(`${API}/community/threads/${threadId}/posts`, {
      headers: { Authorization: `Bearer ${authorToken}` },
      data: { content: "Отличный вопрос, добавил пример конфигурации." },
    });
    expect(reply.status()).toBe(201);

    // Home activity shows the article.
    await page.goto("/");
    await expect(
      page.locator('section:has(h2:text("Активность"))').getByText(`Новая статья: ${TITLE}`)
    ).toBeVisible({ timeout: 20_000 });

    // Article page renders content paragraphs and links to the discussion.
    await page.goto(`/content/articles/${slug}`);
    await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
    await expect(page.getByText(/Пошаговый разбор/)).toBeVisible();
    // Discussion thread link leads to the forum thread with the reply.
    await expect(page.getByText(/открыть тред/)).toBeVisible();
    await page.getByText(/открыть тред/).click();
    await expect(page).toHaveURL(new RegExp(`/community/forum/thread/${threadId}`));
    await expect(page.getByText(/Отличный вопрос/)).toBeVisible({ timeout: 15_000 });
  });

  test("content hub lists the article for guests with category filter (§14)", async ({ page }) => {
    await page.goto("/content");
    await expect(page.getByRole("heading", { name: "Статьи" })).toBeVisible();
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tablist", { name: "Категории статей" }).getByRole("button", { name: "Гайды" }).click();
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });
    // News filter hides the guides article.
    await page.getByRole("button", { name: "Новости" }).click();
    await expect(page.getByText(TITLE)).toHaveCount(0);
  });

  test("search finds the article as a separate group (E-004)", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(TITLE)}`);
    // PLAN-013 redesign: the group heading renders the count in a styled
    // pill element, so the accessible name is "Статьи <n>" (no parentheses).
    await expect(
      page.getByRole("heading", { name: /^Статьи \d/ })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(TITLE).first()).toBeVisible();
  });

  test("reject branch: the reason reaches the author (§17-3)", async ({ page }) => {
    const token = await registerAuthor(page.request, `e2e_ct_rj_${RUN}`);
    const title = `E2E Rejected Article ${RUN}`;
    const created = await page.request.post(`${API}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, content: CONTENT, category: "OPINION" },
    });
    const id = (await created.json()).id;
    await page.request.post(`${API}/content/${id}/submit`, { headers: { Authorization: `Bearer ${token}` } });
    const adminToken = await apiLogin(page.request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const rejected = await page.request.post(`${API}/admin/content/${id}/reject`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { reason: "Слишком мало конкретики по теме" },
    });
    expect(rejected.status()).toBe(200);

    await uiLogin(page, `e2e_ct_rj_${RUN}`, PASSWORD);
    await page.goto("/content/mine");
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Слишком мало конкретики/)).toBeVisible();
  });

  test("mobile /content keeps articles usable (§14/L)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/content");
    await expect(page.getByRole("heading", { name: "Статьи" })).toBeVisible();
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });
  });
});
