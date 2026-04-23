/**
 * Auth — credentials login (ADMIN / DOCTOR / RECEPTIONIST succeed; bad creds fail).
 * TZ §10.Фаза 7 scenario #1.
 */
import { test, expect } from "@playwright/test";

import {
  BASE_URL,
  HAS_TEST_DB,
  isAppHealthy,
  loginAs,
} from "./helpers";
import { NEUROFAX } from "./fixtures/seed-handles";

test.describe("auth — login", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  for (const role of ["admin", "receptionist"] as const) {
    test(`${role} can log in and lands on CRM`, async ({ page }) => {
      const user =
        role === "admin" ? NEUROFAX.admin : NEUROFAX.receptionist;
      await loginAs(page, user, { landing: "/ru/crm" });
      // Root /ru/crm redirects to /ru/crm/reception. Accept either as success.
      await expect(page).toHaveURL(/\/ru\/crm(\/reception)?\/?$/);
    });
  }

  test("doctor can log in and lands on CRM", async ({ page }) => {
    await loginAs(page, NEUROFAX.doctors[0], { landing: "/ru/crm" });
    await expect(page).toHaveURL(/\/ru\/crm(\/reception)?\/?$/);
  });

  test("invalid credentials are rejected", async ({ request }) => {
    const csrf = await request.get(`${BASE_URL}/api/auth/csrf`);
    expect(csrf.ok()).toBeTruthy();
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const res = await request.post(
      `${BASE_URL}/api/auth/callback/credentials`,
      {
        form: {
          csrfToken,
          email: NEUROFAX.admin.email,
          password: "definitely-not-the-password",
          redirect: "false",
          json: "true",
        },
        failOnStatusCode: false,
      },
    );
    // NextAuth v5 returns 200/401 with `url` pointing back to `/login?error=...`
    // or a JSON error body. Either way, no `set-cookie` for a session token.
    const cookies = await request.storageState();
    const sessionCookie = cookies.cookies.find((c) =>
      c.name.includes("session-token"),
    );
    expect(sessionCookie).toBeUndefined();
    if (!res.ok()) {
      expect(res.status()).toBeLessThan(500);
    }
  });
});
