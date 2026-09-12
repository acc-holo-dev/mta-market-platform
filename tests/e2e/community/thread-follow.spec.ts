// PLAN-009 acceptance (§13): Thread Follow в реальном браузере.
//   Пользователь открывает тему → «Следить» → второй пользователь отвечает
//   → первый видит FORUM_REPLY в центре уведомлений → deep link в тему.
//   Отписка через UI; mobile smoke.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { API, RUN, uiLogin, apiRegister, cleanupEntities } from "../../tools/playwright/fixtures";

const FAN_PASSWORD = "e2e-user-password-123";
const FAN = `e2e_tfl_fan_${RUN}`;
const REPLIER = `e2e_tfl_rep_${RUN}`;

test.describe.configure({ mode: "serial" });

let fanToken = "";
let threadId = "";
let threadTitle = "";

/** Spec-local registration returning the bare token (canonical apiRegister). */
async function registerUser(request: APIRequestContext, username: string): Promise<string> {
  const { token } = await apiRegister(request, username, { password: FAN_PASSWORD });
  return token;
}

test.describe("thread follow notifications", () => {
  test.afterAll(async () => {
    // PLAN-016 D-013 hygiene: both run-created users; their forum posts and
    // thread follows cascade with them (the seed thread stays).
    try {
      await cleanupEntities({ usernames: [FAN, REPLIER] });
    } catch (e) {
      console.warn("[thread-follow afterAll] cleanup skipped:", String(e).slice(0, 200));
    }
  });

  test("reader follows a thread via the Follow button (§13)", async ({ page }) => {
    fanToken = await registerUser(page.request, FAN);
    await uiLogin(page, FAN, FAN_PASSWORD);
    await page.goto("/community");
    const threadLink = page.locator('a[href^="/community/forum/thread/"]').first();
    await threadLink.waitFor({ timeout: 15_000 });
    threadId = (await threadLink.getAttribute("href"))!.split("/").pop()!;
    threadTitle = (await threadLink.innerText()).trim();

    await threadLink.click();
    await expect(page.locator("h1").first()).not.toBeEmpty({ timeout: 15_000 });
    await page.getByRole("button", { name: "Следить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Не следить", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/следят/).first()).toBeVisible();
  });

  test("another user replies → follower gets FORUM_REPLY with deep link (§13)", async ({ page }) => {
    const replierToken = await registerUser(page.request, REPLIER);
    const reply = await page.request.post(`${API}/community/threads/${threadId}/posts`, {
      headers: { Authorization: `Bearer ${replierToken}` },
      data: { content: `Ответ для подписчика темы ${RUN}.` },
    });
    expect(reply.status()).toBe(201);

    await uiLogin(page, FAN, FAN_PASSWORD);
    await page.goto("/notifications");
    await expect(
      page.getByText(/Новый ответ в теме/, { exact: false }).first()
    ).toBeVisible({ timeout: 20_000 });

    // Deep link (notification row is a button) leads back to the thread.
    const row = page.locator('button:has-text("Новый ответ в теме")').first();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/community/forum/thread/${threadId}`));
  });

  test("unfollow via UI (§13)", async ({ page }) => {
    await uiLogin(page, FAN, FAN_PASSWORD);
    await page.goto(`/community/forum/thread/${threadId}`);
    await page.getByRole("button", { name: "Не следить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Следить", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // Follow again (state is consistent with the server).
    await page.getByRole("button", { name: "Следить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Не следить", exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("mobile thread page keeps follow usable (§13/L)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/community/forum/thread/${threadId}`);
    await expect(page.getByRole("button", { name: /Следить|Не следить/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});
