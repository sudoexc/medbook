/**
 * Settings — notifications template body edit (Phase 8b).
 *
 * Scenario: ADMIN opens /crm/settings/notifications, edits a template body,
 * saves, sees the success toast, reloads, and the new body persists.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("settings — notifications editor", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("ADMIN edits a template body via API and the value persists", async ({
    page,
    request,
  }) => {
    await as.admin(page);

    // Pull list of templates via the new settings GET.
    const listRes = await request.get(
      `${BASE_URL}/api/crm/settings/notifications/templates`,
      { failOnStatusCode: false },
    );
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as {
      rows?: Array<{
        id: string;
        key: string;
        bodyRu: string;
        bodyUz: string;
        trigger: string;
      }>;
    };
    expect(list.rows).toBeDefined();
    expect(list.rows!.length).toBeGreaterThan(0);

    // Pick a `reminder.confirm` row (APPOINTMENT_CREATED) — its whitelist
    // includes `patient.firstName`, which we'll use in the edit.
    const tpl =
      list.rows!.find((r) => r.key === "reminder.confirm") ?? list.rows![0]!;

    const newBodyRu = `Здравствуйте, {{patient.firstName}}! Edit ${Date.now()}.`;
    const newBodyUz = `Assalomu alaykum, {{patient.firstName}}! Tahrir ${Date.now()}.`;
    const patchRes = await request.patch(
      `${BASE_URL}/api/crm/settings/notifications/templates/${tpl.id}`,
      {
        data: { bodyRu: newBodyRu, bodyUz: newBodyUz },
        failOnStatusCode: false,
      },
    );
    expect([200, 204]).toContain(patchRes.status());

    // Reload list and check persistence.
    const afterRes = await request.get(
      `${BASE_URL}/api/crm/settings/notifications/templates`,
      { failOnStatusCode: false },
    );
    expect(afterRes.ok()).toBeTruthy();
    const after = (await afterRes.json()) as {
      rows?: Array<{ id: string; bodyRu: string; bodyUz: string }>;
    };
    const updated = after.rows!.find((r) => r.id === tpl.id);
    expect(updated).toBeDefined();
    expect(updated!.bodyRu).toBe(newBodyRu);
    expect(updated!.bodyUz).toBe(newBodyUz);

    // Verify the page actually loads (smoke test for the route).
    const resp = await page.goto(`${BASE_URL}/ru/crm/settings/notifications`);
    expect(resp?.ok()).toBeTruthy();
    await expect(page.getByText(/Шаблоны/i).first()).toBeVisible();
  });

  test("PATCH rejects unknown placeholder", async ({ page, request }) => {
    await as.admin(page);
    const listRes = await request.get(
      `${BASE_URL}/api/crm/settings/notifications/templates`,
      { failOnStatusCode: false },
    );
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as {
      rows?: Array<{ id: string; trigger: string }>;
    };
    // Pick a reminder template whose whitelist does NOT include
    // `payment.amount`.
    const tpl =
      list.rows!.find((r) => r.trigger === "APPOINTMENT_BEFORE") ??
      list.rows![0]!;
    const patchRes = await request.patch(
      `${BASE_URL}/api/crm/settings/notifications/templates/${tpl.id}`,
      {
        data: {
          bodyRu: "Платёж {{payment.amount}}", // not in reminder whitelist
        },
        failOnStatusCode: false,
      },
    );
    expect(patchRes.status()).toBe(400);
    const err = (await patchRes.json()) as { error?: string; unknown?: string[] };
    expect(err.error).toBe("UnknownPlaceholder");
    expect(err.unknown).toContain("payment.amount");
  });
});
