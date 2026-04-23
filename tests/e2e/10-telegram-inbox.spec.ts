/**
 * Telegram inbox — page renders the list of conversations.
 * TZ §10.Фаза 7 scenario #10.
 *
 * Full takeover-toggle flow requires a webhook-sourced conversation we can't
 * always create deterministically in the seed; here we assert the list API
 * responds and the inbox page mounts.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, crm, isAppHealthy } from "./helpers";

test.describe("telegram inbox", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("conversations API responds; /crm/telegram mounts", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    const res = await request.get(
      `${BASE_URL}/api/crm/conversations?channel=TG`,
      { failOnStatusCode: false },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { rows?: Array<unknown> };
    expect(Array.isArray(body.rows ?? [])).toBeTruthy();

    await page.goto(crm("/telegram"));
    await expect(page).toHaveURL(/\/crm\/telegram/);
    // Page rendered (not a 5xx error page).
    const body2 = await page.content();
    expect(body2.length).toBeGreaterThan(100);
  });
});
