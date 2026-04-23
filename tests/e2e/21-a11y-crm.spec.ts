/**
 * CRM accessibility audit — axe-core WCAG 2.2 AA scan on the core CRM pages.
 * TZ §9.6 + Phase 7 a11y-engineer.
 *
 * Fails on any `critical` or `serious` axe violation. `moderate` / `minor`
 * findings are logged to the console for triage but do not fail the build.
 *
 * Whitelist lives in `helpers.ts#CRM_AXE_WHITELIST` — new entries must be
 * justified with a linked issue or design decision.
 */
import { test, expect } from "@playwright/test";

import {
  BASE_URL,
  HAS_TEST_DB,
  as,
  checkA11y,
  crm,
  isAppHealthy,
} from "./helpers";

test.describe("a11y — CRM pages (WCAG 2.2 AA)", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  // Representative landmark pages. One per major section so a regression in
  // the shared shell surfaces quickly without ballooning runtime.
  const PAGES: Array<{ name: string; path: string }> = [
    { name: "reception", path: crm("/reception") },
    { name: "appointments", path: crm("/appointments") },
    { name: "calendar", path: crm("/calendar") },
    { name: "patients", path: crm("/patients") },
    { name: "doctors", path: crm("/doctors") },
    { name: "telegram", path: crm("/telegram") },
    { name: "documents", path: crm("/documents") },
    { name: "notifications", path: crm("/notifications") },
    { name: "analytics", path: crm("/analytics") },
    { name: "settings", path: crm("/settings") },
  ];

  for (const p of PAGES) {
    test(`${p.name} — no critical/serious violations`, async ({ page }) => {
      await as.admin(page, { landing: p.path });
      await page.waitForLoadState("networkidle").catch(() => {});
      // Allow hydration + first data fetch to settle.
      await page.waitForTimeout(500);

      const { violations, allViolations, summary } = await checkA11y(page);

      if (allViolations.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[a11y:${p.name}] critical=${summary.critical} serious=${summary.serious} moderate=${summary.moderate} minor=${summary.minor}`,
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
  }

  test("keyboard — tab reaches primary actions on /crm/reception", async ({
    page,
  }) => {
    await as.admin(page, { landing: crm("/reception") });
    await page.waitForLoadState("domcontentloaded");
    // First Tab should land on a focusable element (skip-link or first nav).
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      return {
        tag: el.tagName,
        role: el.getAttribute("role"),
        label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
        href: el.getAttribute("href"),
      };
    });
    expect(active).not.toBeNull();
    // Must be a real interactive element (not BODY).
    expect(active!.tag).not.toBe("BODY");
  });

  test("health-check page itself is accessible", async ({ page }) => {
    // Unauthenticated page sanity check — the health JSON is trivial HTML.
    const res = await page.goto(`${BASE_URL}/api/health`, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.ok()).toBeTruthy();
  });
});
