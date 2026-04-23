/**
 * Call center — SIP webhook POST → incoming call appears in the list.
 * TZ §10.Фаза 7 scenario #11.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("call-center — SIP webhook ingest", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("POST /api/calls/sip/event(ringing) creates a Call row", async ({
    page,
    request,
  }) => {
    await as.admin(page);

    const callId = `e2e-${Date.now()}`;
    // The webhook accepts dev-mode requests without a secret (logs a warning).
    const res = await request.post(
      `${BASE_URL}/api/calls/sip/event?clinicSlug=neurofax`,
      {
        data: {
          kind: "ringing",
          callId,
          from: "+998901112233",
          to: "+998712000001",
          timestamp: new Date().toISOString(),
        },
        failOnStatusCode: false,
      },
    );
    expect([200, 201, 202]).toContain(res.status());

    // Verify via the CRM API that the call was recorded.
    const listRes = await request.get(
      `${BASE_URL}/api/crm/calls?limit=20`,
      { failOnStatusCode: false },
    );
    expect(listRes.ok()).toBeTruthy();
    const body = (await listRes.json()) as {
      rows?: Array<{ sipCallId?: string }>;
    };
    const match = (body.rows ?? []).some((r) => r.sipCallId === callId);
    expect(match).toBeTruthy();
  });
});
