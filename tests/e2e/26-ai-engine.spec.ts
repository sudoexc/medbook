/**
 * Phase 10 — AI engine API happy path.
 *
 * Logs in as the seeded NeuroFax ADMIN and hits the three new AI endpoints:
 *
 *   GET /api/crm/ai/queue       → 200 with `{ items: [...] }`
 *   GET /api/crm/ai/reassign    → 200 with `{ candidates, loads }`
 *   GET /api/crm/ai/eta         → 400 without appointmentId
 *
 * Tenancy and shape only — the engine math is exhaustively covered by the
 * unit suite. Self-skips when the test DB / app aren't reachable, mirroring
 * the convention from the other Phase 7+ specs (e.g. 25-feature-flags).
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("AI engine — happy paths", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("ADMIN can read queue / reassign and gets 400 for empty eta", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await as.admin(page);

    try {
      // 1. Queue scoring — must return an items array (possibly empty).
      const queueRes = await ctx.request.get(`${BASE_URL}/api/crm/ai/queue`, {
        failOnStatusCode: false,
      });
      expect(queueRes.status()).toBe(200);
      const queueBody = (await queueRes.json()) as { items?: unknown };
      expect(Array.isArray(queueBody.items)).toBe(true);

      // 2. Reassignment — must always return `{ candidates, loads }`.
      const reassignRes = await ctx.request.get(
        `${BASE_URL}/api/crm/ai/reassign`,
        { failOnStatusCode: false },
      );
      expect(reassignRes.status()).toBe(200);
      const reassignBody = (await reassignRes.json()) as {
        candidates?: unknown;
        loads?: unknown;
      };
      expect(Array.isArray(reassignBody.candidates)).toBe(true);
      expect(Array.isArray(reassignBody.loads)).toBe(true);

      // 3. ETA without appointmentId → 400 ValidationError.
      const etaRes = await ctx.request.get(`${BASE_URL}/api/crm/ai/eta`, {
        failOnStatusCode: false,
      });
      expect(etaRes.status()).toBe(400);
      const etaBody = (await etaRes.json()) as { error?: string };
      expect(etaBody.error).toBe("ValidationError");

      // 4. ETA with bogus id → 404.
      const etaMissing = await ctx.request.get(
        `${BASE_URL}/api/crm/ai/eta?appointmentId=does-not-exist`,
        { failOnStatusCode: false },
      );
      expect(etaMissing.status()).toBe(404);
    } finally {
      await ctx.close();
    }
  });
});
