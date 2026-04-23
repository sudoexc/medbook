/**
 * Mini-App accessibility audit — axe-core WCAG 2.2 AA scan on the Telegram
 * Mini App home screen and a secondary route.
 * TZ §9.6 + Phase 7 a11y-engineer.
 *
 * Runs on the mobile project (matches /miniapp-.*\.spec\.ts/ in the
 * Playwright config's `testMatch`). The filename contains `miniapp-` so it
 * picks up the 375×812 Pixel 5 viewport automatically.
 *
 * Mini App pages are rendered inside Telegram's in-app browser so we do not
 * have a full cookie-based session — axe still inspects the static markup
 * and auth state is not required for the a11y contract (ARIA structure,
 * contrast, focus). The `x-telegram-init-data` header is not needed for
 * the fallback "Open in Telegram" screen which is the layout a11y anchor.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, checkA11y, isAppHealthy } from "./helpers";

test.describe("a11y — Mini App (WCAG 2.2 AA)", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("home screen — no critical/serious violations", async ({ page }) => {
    // The Mini App tries to call `/api/miniapp/auth` on mount. Without a
    // signed initData it falls back to the "Open in Telegram" screen — that
    // IS the screen we want axe to inspect here, since it's what users see
    // when opening the URL directly in a browser.
    const res = await page.goto(`${BASE_URL}/c/neurofax/my`, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.ok()).toBeTruthy();
    // Wait for fallback content to render.
    await page.waitForTimeout(500);

    const { violations, allViolations, summary } = await checkA11y(page);
    if (allViolations.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[a11y:miniapp-home] critical=${summary.critical} serious=${summary.serious} moderate=${summary.moderate} minor=${summary.minor}`,
      );
      for (const v of allViolations) {
        // eslint-disable-next-line no-console
        console.log(
          `  ${v.id} [${v.impact ?? "unknown"}] ${v.help} (${v.nodes.length} nodes)`,
        );
      }
    }
    expect(
      violations.map((v) => `${v.id} [${v.impact ?? "?"}] ${v.help}`),
    ).toEqual([]);
  });

  test("book flow entry has accessible structure", async ({ page }) => {
    // `/c/[slug]/my/book` should also render its fallback with axe-clean
    // markup when initData is missing.
    const res = await page.goto(`${BASE_URL}/c/neurofax/my/book`, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.ok()).toBeTruthy();
    await page.waitForTimeout(500);

    const { violations, summary } = await checkA11y(page);
    if (violations.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[a11y:miniapp-book] critical=${summary.critical} serious=${summary.serious}`,
      );
    }
    expect(
      violations.map((v) => `${v.id} [${v.impact ?? "?"}] ${v.help}`),
    ).toEqual([]);
  });
});
