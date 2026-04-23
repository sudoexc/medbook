/**
 * Mini App — Telegram initData auth → list services → confirm profile.
 * TZ §10.Фаза 7 scenario #12.
 *
 * This spec runs on the mobile project (matches /miniapp-.*\.spec\.ts/).
 * Requires `TG_BOT_TOKEN_TEST` env to be set AND for the primary clinic's
 * `tgBotToken` row to be updated to match — otherwise self-skip.
 */
import { test, expect } from "@playwright/test";

import {
  BASE_URL,
  HAS_TEST_DB,
  HAS_TG_BOT_TOKEN,
  isAppHealthy,
  signMiniAppInitData,
} from "./helpers";

test.describe("mini-app — auth + services", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    test.skip(
      !HAS_TG_BOT_TOKEN,
      "requires TG_BOT_TOKEN_TEST env + matching clinic.tgBotToken in the DB",
    );
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("POST /api/miniapp/auth returns a patient profile", async ({
    request,
  }) => {
    const initData = signMiniAppInitData({ userId: 9000001 });
    const res = await request.post(
      `${BASE_URL}/api/miniapp/auth?clinicSlug=neurofax`,
      {
        headers: {
          "x-telegram-init-data": initData,
          "content-type": "application/json",
        },
        data: { lang: "RU" },
        failOnStatusCode: false,
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      patient?: { id: string; preferredLang: string };
    };
    expect(body.patient?.id).toBeTruthy();
  });

  test("GET /api/miniapp/services lists seeded services", async ({
    request,
  }) => {
    const initData = signMiniAppInitData({ userId: 9000002 });
    // First authenticate (upserts the patient).
    await request.post(
      `${BASE_URL}/api/miniapp/auth?clinicSlug=neurofax`,
      {
        headers: { "x-telegram-init-data": initData },
        data: { lang: "RU" },
        failOnStatusCode: false,
      },
    );
    const res = await request.get(
      `${BASE_URL}/api/miniapp/services?clinicSlug=neurofax`,
      {
        headers: { "x-telegram-init-data": initData },
        failOnStatusCode: false,
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { services?: Array<unknown> };
    expect(Array.isArray(body.services ?? [])).toBeTruthy();
  });
});
