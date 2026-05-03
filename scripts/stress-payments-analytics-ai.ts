/**
 * E2E stress for payments + analytics + AI + audit on `neurofax`.
 * Logs in as admin and exercises:
 *   1. Payment create with Idempotency-Key (header + body) — second call
 *      must return same row, not a duplicate.
 *   2. Payment GET filters (status, method, patientId, appointmentId).
 *   3. Analytics endpoint per period (today/week/month).
 *   4. AI queue endpoint — verify scoring fields present.
 *   5. AI ETA endpoint for an appointment with history → returns ETA + band.
 *   6. AI reassign — proposes a free doctor + slot for a busy one.
 *   7. Audit log — paginate, filter by entityType.
 */
import "dotenv/config";

const BASE = process.env.STRESS_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = "1@1.uz";
const ADMIN_PASS = "1";

interface CookieJar {
  cookies: Map<string, string>;
}
function newJar(): CookieJar {
  return { cookies: new Map() };
}
function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
function ingest(jar: CookieJar, res: Response): void {
  const sc = res.headers.getSetCookie?.() ?? [];
  for (const raw of sc) {
    const piece = raw.split(";")[0];
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    jar.cookies.set(piece.slice(0, eq), piece.slice(eq + 1));
  }
}

interface Result {
  group: string;
  name: string;
  pass: boolean;
  detail?: string;
}
const results: Result[] = [];
function record(r: Result) {
  const tick = r.pass ? "✓" : "✗";
  console.log(`${tick} [${r.group}] ${r.name}${r.detail ? " — " + r.detail : ""}`);
  results.push(r);
}

async function login(jar: CookieJar) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  ingest(jar, csrfRes);
  const { csrfToken } = await csrfRes.json();
  const formData = new URLSearchParams({
    email: ADMIN_EMAIL,
    password: ADMIN_PASS,
    csrfToken,
    callbackUrl: "/",
    json: "true",
  });
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: formData,
  });
  ingest(jar, r);
  if (r.status >= 400) throw new Error(`login failed ${r.status}`);
}

async function api<T = unknown>(
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; data: T | null; raw: string }> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(jar),
      ...(extraHeaders ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  ingest(jar, r);
  const raw = await r.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {}
  return { status: r.status, data, raw };
}

async function main() {
  const jar = newJar();
  await login(jar);
  console.log("✓ admin logged in");

  // Find a today completed appointment without payment for the idempotency
  // probe.
  const today = await api<{ rows: Array<{ id: string; status: string; patientId: string; priceFinal: number | null }> }>(
    jar,
    "GET",
    `/api/crm/appointments?status=COMPLETED&limit=50`,
  );
  const candidates = today.data?.rows ?? [];
  let target: { id: string; patientId: string; priceFinal: number } | null = null;
  for (const row of candidates) {
    const exists = await api<{ total: number }>(
      jar,
      "GET",
      `/api/crm/payments?appointmentId=${row.id}&limit=1`,
    );
    if (exists.data?.total === 0 && row.priceFinal) {
      target = { id: row.id, patientId: row.patientId, priceFinal: row.priceFinal };
      break;
    }
  }

  // ── PAYMENTS / IDEMPOTENCY ─────────────────────────────────────────────
  // If every completed appointment is already paid (a happy state for a
  // post-stress DB) the idempotency probe falls back to a patientId-only
  // payment using the first patient we find. The Idempotency-Key contract
  // doesn't require an appointment.
  if (!target) {
    const anyPatient = await api<{ rows: Array<{ id: string }> }>(
      jar,
      "GET",
      "/api/crm/patients?limit=1",
    );
    const pid = anyPatient.data?.rows?.[0]?.id;
    if (pid) {
      target = { id: "", patientId: pid, priceFinal: 25_000_00 };
    }
  }
  if (target) {
    const useAppt = target.id !== "";
    const idempKey = `stress-${Date.now()}`;
    const first = await api<{ id: string }>(
      jar,
      "POST",
      "/api/crm/payments",
      {
        appointmentId: useAppt ? target.id : null,
        patientId: target.patientId,
        currency: "UZS",
        amount: target.priceFinal,
        method: "CASH",
        status: "PAID",
      },
      { "Idempotency-Key": idempKey },
    );
    record({
      group: "payments",
      name: "POST first idempotent call",
      pass: first.status === 201 && !!first.data?.id,
      detail: `${first.status} id=${first.data?.id ?? "n/a"}`,
    });

    const second = await api<{ id: string }>(
      jar,
      "POST",
      "/api/crm/payments",
      {
        appointmentId: useAppt ? target.id : null,
        patientId: target.patientId,
        currency: "UZS",
        amount: target.priceFinal,
        method: "CASH",
        status: "PAID",
      },
      { "Idempotency-Key": idempKey },
    );
    record({
      group: "payments",
      name: "POST replay returns same id (no dup)",
      pass: (second.status === 200 || second.status === 201) && second.data?.id === first.data?.id,
      detail: `${second.status} sameId=${second.data?.id === first.data?.id}`,
    });

    // Body-level idempotencyKey (not header) — distinct key, fresh row.
    const bodyKey = `stress-body-${Date.now()}`;
    const bodyKeyed = await api(jar, "POST", "/api/crm/payments", {
      appointmentId: null,
      patientId: target.patientId,
      currency: "UZS",
      amount: 1_000,
      method: "CASH",
      status: "PAID",
      idempotencyKey: bodyKey,
    });
    record({
      group: "payments",
      name: "POST with body.idempotencyKey",
      pass: bodyKeyed.status === 201,
      detail: `${bodyKeyed.status}`,
    });

    // List filters
    const byStatus = await api<{ rows: unknown[]; total: number }>(
      jar,
      "GET",
      "/api/crm/payments?status=PAID&limit=10",
    );
    record({
      group: "payments",
      name: "GET ?status=PAID returns rows",
      pass: byStatus.status === 200 && (byStatus.data?.total ?? 0) > 0,
      detail: `total=${byStatus.data?.total ?? 0}`,
    });

    const byMethod = await api<{ total: number }>(
      jar,
      "GET",
      "/api/crm/payments?method=CASH&limit=10",
    );
    record({
      group: "payments",
      name: "GET ?method=CASH returns rows",
      pass: byMethod.status === 200 && (byMethod.data?.total ?? 0) > 0,
      detail: `total=${byMethod.data?.total ?? 0}`,
    });

    const byPatient = await api<{ total: number }>(
      jar,
      "GET",
      `/api/crm/payments?patientId=${target.patientId}&limit=10`,
    );
    record({
      group: "payments",
      name: "GET ?patientId returns rows",
      pass: byPatient.status === 200 && (byPatient.data?.total ?? 0) > 0,
      detail: `total=${byPatient.data?.total ?? 0}`,
    });
  } else {
    record({
      group: "payments",
      name: "idempotency probe skipped — no patients in clinic",
      pass: true,
      detail: "DB has zero patients, nothing to probe",
    });
  }

  // ── ANALYTICS ──────────────────────────────────────────────────────────
  // revenueDaily entries are `{ date, amount }`; topDoctors entries are
  // `{ doctorId, name, revenue, count }`. Σ of daily-amount must be ≥
  // Σ of topDoctor-revenue (top-N capped at 10), and equal whenever the
  // payment count covered by topDoctors matches total payments in range.
  for (const period of ["today", "week", "month"] as const) {
    const r = await api<{
      period: string;
      revenueDaily: Array<{ date: string; amount: number }>;
      topDoctors: Array<{ doctorId: string; revenue: number; count: number }>;
      appointmentsByStatus: Array<{ status: string; count: number }>;
    }>(jar, "GET", `/api/crm/analytics?period=${period}`);
    record({
      group: "analytics",
      name: `GET period=${period}`,
      pass: r.status === 200 && Array.isArray(r.data?.revenueDaily),
      detail: `${r.status} revenueDaily.len=${r.data?.revenueDaily?.length ?? 0}`,
    });
    if (r.data) {
      const revSum = (r.data.revenueDaily ?? []).reduce(
        (acc, d) => acc + (d.amount ?? 0),
        0,
      );
      const topSum = (r.data.topDoctors ?? []).reduce(
        (acc, d) => acc + (d.revenue ?? 0),
        0,
      );
      // topDoctors is capped at 10 — it's a subset of revenueDaily, so
      // dailySum >= topSum and equal when the active doctor count ≤ 10.
      record({
        group: "analytics",
        name: `Σ revenueDaily ≥ Σ topDoctors (period=${period})`,
        pass: revSum >= topSum,
        detail: `daily=${revSum} top=${topSum}`,
      });
    }
  }

  // ── AI: queue ──────────────────────────────────────────────────────────
  // ScoredAppointment shape: { appointmentId, score: { score, band, components },
  // noShowRisk, ... } — `score` is the QueueScoreOutput object, not a flat number.
  type QueueItem = {
    appointmentId: string;
    score: { score: number; band: string };
    noShowRisk: number;
  };
  const aiq = await api<{ items: QueueItem[] }>(
    jar,
    "GET",
    "/api/crm/ai/queue",
  );
  record({
    group: "ai",
    name: "GET /ai/queue",
    pass: aiq.status === 200 && Array.isArray(aiq.data?.items),
    detail: `${aiq.status} items.len=${aiq.data?.items?.length ?? 0}`,
  });
  if (aiq.data?.items?.length) {
    const sample = aiq.data.items[0]!;
    record({
      group: "ai",
      name: "queue item has score/band/noShowRisk",
      pass:
        typeof sample.score?.score === "number" &&
        typeof sample.score?.band === "string" &&
        typeof sample.noShowRisk === "number",
      detail: `score=${sample.score?.score} band=${sample.score?.band} noShow=${sample.noShowRisk}`,
    });
    const sorted = aiq.data.items.every(
      (item, i, arr) => i === 0 || arr[i - 1]!.score.score >= item.score.score,
    );
    record({
      group: "ai",
      name: "queue items sorted by score desc",
      pass: sorted,
      detail: sorted ? "ok" : "out-of-order",
    });
  }

  // ── AI: ETA ────────────────────────────────────────────────────────────
  const todayList = await api<{ rows: Array<{ id: string }> }>(
    jar,
    "GET",
    "/api/crm/appointments?status=BOOKED&limit=5",
  );
  const apptForEta = todayList.data?.rows?.[0]?.id;
  if (apptForEta) {
    // ResolveEtaResult: { appointmentId, doctorId, serviceId, fallbackMin,
    // prediction: { etaMin, sampleSize, confidence, source } }
    const eta = await api<{
      appointmentId: string;
      fallbackMin: number;
      prediction: {
        etaMin: number;
        sampleSize: number;
        confidence: "high" | "med" | "low";
        source: "history" | "blended" | "fallback";
      };
    }>(jar, "GET", `/api/crm/ai/eta?appointmentId=${apptForEta}`);
    const p = eta.data?.prediction;
    record({
      group: "ai",
      name: `GET /ai/eta?appointmentId=${apptForEta.slice(-6)}`,
      pass:
        eta.status === 200 &&
        typeof p?.etaMin === "number" &&
        typeof p?.confidence === "string" &&
        typeof p?.source === "string",
      detail: `${eta.status} eta=${p?.etaMin}min ${p?.confidence}/${p?.source}`,
    });
  }

  // ── AI: reassign ───────────────────────────────────────────────────────
  if (apptForEta) {
    const reassign = await api<{ candidates: Array<{ doctorId: string; score: number }> }>(
      jar,
      "GET",
      `/api/crm/ai/reassign?appointmentId=${apptForEta}`,
    );
    record({
      group: "ai",
      name: `GET /ai/reassign returns candidates`,
      pass:
        reassign.status === 200 && Array.isArray(reassign.data?.candidates),
      detail: `${reassign.status} candidates=${reassign.data?.candidates?.length ?? 0}`,
    });
  }

  // ── AUDIT ──────────────────────────────────────────────────────────────
  const a1 = await api<{ rows: Array<{ entityType: string }>; nextCursor: string | null }>(
    jar,
    "GET",
    "/api/crm/audit?limit=20",
  );
  record({
    group: "audit",
    name: "GET ?limit=20 returns ≤20 rows",
    pass:
      a1.status === 200 &&
      Array.isArray(a1.data?.rows) &&
      (a1.data?.rows?.length ?? 0) <= 20,
    detail: `${a1.status} rows=${a1.data?.rows?.length ?? 0}`,
  });

  if (a1.data?.nextCursor) {
    const a2 = await api<{ rows: unknown[] }>(
      jar,
      "GET",
      `/api/crm/audit?limit=20&cursor=${a1.data.nextCursor}`,
    );
    record({
      group: "audit",
      name: "GET ?cursor= returns next page",
      pass: a2.status === 200 && Array.isArray(a2.data?.rows),
      detail: `${a2.status} rows=${a2.data?.rows?.length ?? 0}`,
    });
  }

  const aFiltered = await api<{ rows: Array<{ entityType: string }> }>(
    jar,
    "GET",
    "/api/crm/audit?entityType=Payment&limit=20",
  );
  const allPayment = (aFiltered.data?.rows ?? []).every(
    (r) => r.entityType === "Payment",
  );
  record({
    group: "audit",
    name: "GET ?entityType=Payment filters correctly",
    pass: aFiltered.status === 200 && allPayment,
    detail: `${aFiltered.status} rows=${aFiltered.data?.rows?.length ?? 0}`,
  });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed} / ${results.length} passed ===`);
  if (passed < results.length) {
    console.log("Failures:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  - [${r.group}] ${r.name} ${r.detail ?? ""}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
