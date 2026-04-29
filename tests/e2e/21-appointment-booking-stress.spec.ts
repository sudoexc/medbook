/**
 * Appointment booking stress — overbooking guarantees, lifecycle, cross-channel.
 *
 * What this spec covers (each step builds on the previous one — runs serial):
 *   1. Setup: pick a deterministic far-future weekday, fetch fixtures.
 *   2. CRM POST → 201.
 *   3. CRM POST same slot → 409 doctor_busy (app-level conflict detection).
 *   4. Touching boundary [N+30 → N+60] right after [N → N+30] → 201
 *      (the EXCLUDE constraint uses `[)` semantics — touching is fine).
 *   5. Different doctor, SAME cabinet, overlapping window → 409 cabinet_busy.
 *   6. PATCH (reschedule) the original to +2h → original slot frees.
 *   7. CRM POST into the now-free slot → 201.
 *   8. Concurrent burst: 5 parallel POSTs to the same slot. Exactly one wins
 *      (covers Serializable retry + EXCLUDE backstop — neither layer alone
 *      catches every interleaving).
 *   9. DELETE (soft-cancel) → re-book same slot → 201 (CANCELLED rows must
 *      not block via the EXCLUDE constraint).
 *  10. Lifecycle BOOKED → IN_PROGRESS → COMPLETED *early*: GET should show
 *      `endDate ≈ now`, `durationMin` shrunk; the freed tail is bookable.
 *  11. Set NO_SHOW → re-book same slot → 201 (NO_SHOW rows also free the slot).
 *
 * Skips when no test DB is reachable (mirrors the rest of the e2e suite).
 */
import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";

import {
  BASE_URL,
  HAS_TEST_DB,
  as,
  firstPatientId,
  firstService,
  isAppHealthy,
} from "./helpers";

interface Doctor {
  id: string;
}
interface Cabinet {
  id: string;
}
interface Created {
  id: string;
  date: string;
  endDate: string;
  durationMin: number;
  status: string;
}

async function postAppointment(
  request: APIRequestContext,
  payload: Record<string, unknown>,
) {
  return request.post(`${BASE_URL}/api/crm/appointments`, {
    data: payload,
    failOnStatusCode: false,
  });
}

async function fetchFirstTwoDoctors(
  ctx: APIRequestContext,
): Promise<Doctor[]> {
  const res = await ctx.get(`${BASE_URL}/api/crm/doctors?limit=5`, {
    failOnStatusCode: false,
  });
  if (!res.ok()) return [];
  const body = (await res.json()) as { rows?: Array<Doctor> };
  return body.rows ?? [];
}

async function fetchFirstCabinet(
  ctx: APIRequestContext,
): Promise<Cabinet | null> {
  const res = await ctx.get(`${BASE_URL}/api/crm/cabinets?limit=1`, {
    failOnStatusCode: false,
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as { rows?: Array<Cabinet> };
  return body.rows?.[0] ?? null;
}

/**
 * Pick a slot N business days from now at the given local hour. We push 14d+
 * out so we never collide with seed appointments (which clump in the next
 * couple of weeks). Hour 15 keeps us inside a typical Mon–Fri 09:00–18:00
 * doctor schedule.
 *
 * Slots are shifted by a per-run randomized minute offset (multiple of 5)
 * so reruns of this spec don't collide with leftover rows from a previous
 * aborted run. The offset is picked once at module load and applied to
 * every slot in the suite.
 */
// 5..55 min, multiple of 5. Never 0 — guarantees we don't land on a slot
// from a previous run that started at the top of the hour.
const RUN_MINUTE_OFFSET = 5 + 5 * Math.floor((Date.now() / 1000) % 11);

function futureSlot(daysAhead: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(hour, minute + RUN_MINUTE_OFFSET, 0, 0);
  return d;
}

test.describe.serial("appointments — booking stress (overbook + lifecycle)", () => {
  let doctorId: string;
  let secondDoctorId: string | null;
  let patientId: string;
  let cabinetId: string | null;
  let service: { id: string; durationMin: number };
  let originalApptId: string;
  let baseSlot: Date;
  // Each test calling `as.admin(page)` would hit NextAuth's per-IP rate
  // limit after a handful of POSTs. Login once per worker and reuse the
  // resulting cookie jar via `request` for all API mutations.
  let ctx: BrowserContext;
  let request: APIRequestContext;

  test.beforeAll(async ({ browser }) => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    await as.admin(page);
    await page.close();
    request = ctx.request;
  });

  test.afterAll(async () => {
    await ctx?.close();
  });

  test("01 setup — fetch fixtures + clean leftover bookings on test doctor", async () => {
    const [doctors, patient, svc, cab] = await Promise.all([
      fetchFirstTwoDoctors(request),
      firstPatientId(ctx),
      firstService(ctx),
      fetchFirstCabinet(request),
    ]);
    test.skip(
      doctors.length === 0 || !patient || !svc,
      "seed missing required fixtures",
    );
    doctorId = doctors[0]!.id;
    secondDoctorId = doctors[1]?.id ?? null;
    patientId = patient!;
    service = svc!;
    cabinetId = cab?.id ?? null;
    baseSlot = futureSlot(14, 15, 0);

    // Stress-spec doctor accumulates leftover non-cancelled rows from prior
    // (possibly aborted) runs. Clear future bookings on the doctors we'll
    // touch so each run starts with a clean slate. Window ±60 days covers
    // every slot this spec creates with margin.
    const from = new Date();
    const to = new Date(from.getTime() + 60 * 24 * 60 * 60 * 1000);
    const targets = [doctorId, secondDoctorId].filter(
      (v): v is string => Boolean(v),
    );
    for (const docId of targets) {
      let cursor: string | null = null;
      let purged = 0;
      for (let i = 0; i < 20; i++) {
        const url = new URL(`${BASE_URL}/api/crm/appointments`);
        url.searchParams.set("doctorId", docId);
        url.searchParams.set("from", from.toISOString());
        url.searchParams.set("to", to.toISOString());
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);
        const listRes = await request.get(url.toString(), {
          failOnStatusCode: false,
        });
        if (!listRes.ok()) break;
        const body = (await listRes.json()) as {
          rows?: Array<{ id: string; status: string }>;
          nextCursor?: string | null;
        };
        const rows = body.rows ?? [];
        if (rows.length === 0) break;
        for (const row of rows) {
          if (row.status === "CANCELLED" || row.status === "NO_SHOW") continue;
          await request.delete(`${BASE_URL}/api/crm/appointments/${row.id}`, {
            failOnStatusCode: false,
          });
          purged++;
        }
        if (!body.nextCursor) break;
        cursor = body.nextCursor;
      }
      if (purged > 0) {
        // Surfaced via Playwright reporter so leftover-state buildup is visible.
        // eslint-disable-next-line no-console
        console.log(`[stress-spec] cleanup: cancelled ${purged} leftover rows on doctor ${docId}`);
      }
    }
  });

  test("02 CRM POST — first booking succeeds", async () => {
    const res = await postAppointment(request, {
      patientId,
      doctorId,
      cabinetId,
      date: baseSlot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(
      res.status(),
      `expected 201, got ${res.status()} body=${await res.text()}`,
    ).toBe(201);
    const body = (await res.json()) as Created;
    expect(body.id).toBeTruthy();
    expect(body.status).toBe("BOOKED");
    originalApptId = body.id;
  });

  test("03 CRM POST same slot — 409 doctor_busy", async () => {
    const res = await postAppointment(request, {
      patientId,
      doctorId,
      date: baseSlot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toBe("conflict");
    expect(["doctor_busy", "cabinet_busy"]).toContain(body.reason);
  });

  test("04 touching boundary — back-to-back slots succeed", async () => {
    // Book [base + duration, base + 2*duration]. With `[)` range semantics
    // touching at the boundary is not an overlap.
    const touching = new Date(
      baseSlot.getTime() + service.durationMin * 60_000,
    );
    const res = await postAppointment(request, {
      patientId,
      doctorId,
      date: touching.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(
      res.status(),
      `expected 201, got ${res.status()} body=${await res.text()}`,
    ).toBe(201);
    const { id } = (await res.json()) as Created;
    await request.delete(`${BASE_URL}/api/crm/appointments/${id}`, {
      failOnStatusCode: false,
    });
  });

  test("05 cabinet collision — different doctor, same cabinet, overlap → 409", async () => {
    test.skip(!secondDoctorId, "needs at least 2 seeded doctors");
    test.skip(!cabinetId, "no cabinet seeded — cabinet collision unverifiable");
    // Move the first appointment INTO the cabinet so we have something to
    // collide with. (The original POST passed `cabinetId`, but only if the
    // seed had one — re-PATCH to be safe.)
    await request.patch(`${BASE_URL}/api/crm/appointments/${originalApptId}`, {
      data: { cabinetId },
      failOnStatusCode: false,
    });
    const overlapping = new Date(baseSlot.getTime() + 5 * 60_000);
    const res = await postAppointment(request, {
      patientId,
      doctorId: secondDoctorId!,
      cabinetId,
      date: overlapping.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { reason?: string };
    expect(["cabinet_busy", "doctor_busy"]).toContain(body.reason);
  });

  test("06 reschedule the original +2h — original slot becomes free", async () => {
    const later = new Date(baseSlot.getTime() + 2 * 60 * 60 * 1000);
    const res = await request.patch(
      `${BASE_URL}/api/crm/appointments/${originalApptId}`,
      {
        data: { date: later.toISOString() },
        failOnStatusCode: false,
      },
    );
    expect(
      res.ok(),
      `expected 2xx, got ${res.status()} body=${await res.text()}`,
    ).toBeTruthy();
  });

  test("07 re-book the freed original slot — succeeds", async () => {
    const res = await postAppointment(request, {
      patientId,
      doctorId,
      date: baseSlot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(res.status()).toBe(201);
    const { id } = (await res.json()) as Created;
    await request.delete(`${BASE_URL}/api/crm/appointments/${id}`, {
      failOnStatusCode: false,
    });
  });

  test("08 concurrent burst — 5 parallel POSTs, exactly 1 wins", async () => {
    const slot = futureSlot(15, 11, 0);
    const payload = {
      patientId,
      doctorId,
      date: slot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    };
    const results = await Promise.all(
      Array.from({ length: 5 }).map(() => postAppointment(request, payload)),
    );
    const statuses = results.map((r) => r.status()).sort();
    const winners = statuses.filter((s) => s === 201);
    const losers = statuses.filter((s) => s === 409);
    if (winners.length !== 1 || losers.length !== 4) {
      const bodies = await Promise.all(
        results.map(async (r) => ({ status: r.status(), body: await r.text() })),
      );
      // eslint-disable-next-line no-console
      console.log("[stress-spec] burst statuses:", JSON.stringify(bodies, null, 2));
    }
    expect(
      winners.length,
      `expected exactly 1 winner among ${JSON.stringify(statuses)}`,
    ).toBe(1);
    expect(
      losers.length,
      `expected 4× 409, got ${JSON.stringify(statuses)}`,
    ).toBe(4);
    const winnerIdx = results.findIndex((r) => r.status() === 201);
    const winnerBody = (await results[winnerIdx]!.json()) as Created;
    await request.delete(
      `${BASE_URL}/api/crm/appointments/${winnerBody.id}`,
      { failOnStatusCode: false },
    );
  });

  test("09 cancel frees the slot — DELETE then re-book → 201", async () => {
    const slot = futureSlot(16, 10, 0);
    const created = await postAppointment(request, {
      patientId,
      doctorId,
      date: slot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as Created;
    const cancel = await request.delete(
      `${BASE_URL}/api/crm/appointments/${id}`,
      { failOnStatusCode: false },
    );
    expect(cancel.ok()).toBeTruthy();
    const rebook = await postAppointment(request, {
      patientId,
      doctorId,
      date: slot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(rebook.status()).toBe(201);
    const { id: rebookId } = (await rebook.json()) as Created;
    await request.delete(`${BASE_URL}/api/crm/appointments/${rebookId}`, {
      failOnStatusCode: false,
    });
  });

  test("10 lifecycle — COMPLETED early shrinks endDate", async () => {
    const slot = futureSlot(17, 12, 0);
    const created = await postAppointment(request, {
      patientId,
      doctorId,
      date: slot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(created.status()).toBe(201);
    const orig = (await created.json()) as Created;

    const startRes = await request.patch(
      `${BASE_URL}/api/crm/appointments/${orig.id}/queue-status`,
      { data: { queueStatus: "IN_PROGRESS" }, failOnStatusCode: false },
    );
    expect(startRes.ok()).toBeTruthy();

    // Mark COMPLETED *now* — the booked endDate is far in the future, so the
    // shrink path must trigger.
    const completeRes = await request.patch(
      `${BASE_URL}/api/crm/appointments/${orig.id}/queue-status`,
      { data: { queueStatus: "COMPLETED" }, failOnStatusCode: false },
    );
    expect(completeRes.ok()).toBeTruthy();

    const getRes = await request.get(
      `${BASE_URL}/api/crm/appointments/${orig.id}`,
      { failOnStatusCode: false },
    );
    expect(getRes.ok()).toBeTruthy();
    const after = (await getRes.json()) as Created;
    expect(
      new Date(after.endDate).getTime(),
      `expected endDate to shrink below ${orig.endDate}, got ${after.endDate}`,
    ).toBeLessThan(new Date(orig.endDate).getTime());
    expect(after.durationMin).toBeLessThan(orig.durationMin);
    expect(after.status).toBe("COMPLETED");

    // The freed tail (after.endDate → orig.endDate) must now be bookable.
    const tailRes = await postAppointment(request, {
      patientId,
      doctorId,
      date: new Date(after.endDate).toISOString(),
      durationMin: Math.min(
        service.durationMin,
        Math.max(
          5,
          Math.floor(
            (new Date(orig.endDate).getTime() -
              new Date(after.endDate).getTime()) /
              60_000,
          ),
        ),
      ),
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    // Either it fits (201) or it landed past schedule edge (outside_schedule).
    // doctor_busy here would be a real bug — assert that's NOT the reason.
    if (tailRes.status() === 409) {
      const body = (await tailRes.json()) as { reason?: string };
      expect(body.reason).not.toBe("doctor_busy");
      expect(body.reason).not.toBe("cabinet_busy");
    } else {
      expect(tailRes.status()).toBe(201);
      const tail = (await tailRes.json()) as Created;
      await request.delete(`${BASE_URL}/api/crm/appointments/${tail.id}`, {
        failOnStatusCode: false,
      });
    }
  });

  test("11 NO_SHOW frees the slot — re-book same window → 201", async () => {
    const slot = futureSlot(18, 14, 0);
    const created = await postAppointment(request, {
      patientId,
      doctorId,
      date: slot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as Created;
    const noShow = await request.patch(
      `${BASE_URL}/api/crm/appointments/${id}`,
      { data: { status: "NO_SHOW" }, failOnStatusCode: false },
    );
    expect(noShow.ok()).toBeTruthy();
    const rebook = await postAppointment(request, {
      patientId,
      doctorId,
      date: slot.toISOString(),
      durationMin: service.durationMin,
      serviceIds: [service.id],
      channel: "WALKIN",
    });
    expect(rebook.status()).toBe(201);
    const { id: rebookId } = (await rebook.json()) as Created;
    await request.delete(`${BASE_URL}/api/crm/appointments/${rebookId}`, {
      failOnStatusCode: false,
    });
  });

  test("99 cleanup — cancel the original tracked appointment", async () => {
    if (originalApptId) {
      await request.delete(
        `${BASE_URL}/api/crm/appointments/${originalApptId}`,
        { failOnStatusCode: false },
      );
    }
  });
});
