/**
 * GET /api/platform/usage — per-clinic counters across the installation.
 *
 * Query: `period=week|month` and optional `from`/`to`. If no range provided
 * we bracket on the period:
 *   - week  → last 7 days ending now
 *   - month → last 30 days ending now
 *
 * Counters returned per clinic:
 *   - appointments      (by createdAt)
 *   - smsSent           (legacy historical counter — SMS was removed in
 *                        `docs/TZ-sms-removal.md`. No new SMS rows are
 *                        produced after Wave 3; once Wave 5 drops the
 *                        enum literal this column returns 0 for all
 *                        ranges past the migration date. Kept so the
 *                        platform dashboard can still surface the legacy
 *                        SMS bill against months that pre-date removal.)
 *   - tgMessages        (Message direction=OUT kind=TEXT/... in Conversation)
 *   - calls             (Call createdAt)
 *   - patients          (Patient createdAt — new patients acquired)
 *
 * We run under SUPER_ADMIN so Prisma doesn't auto-scope; each groupBy
 * carries a `clinicId` dimension.
 */
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { createPlatformListHandler } from "@/server/platform/handler";
import { QueryPlatformUsageSchema } from "@/server/schemas/platform";

export const GET = createPlatformListHandler(async ({ request }) => {
  const parsed = parseQuery(request, QueryPlatformUsageSchema);
  if (!parsed.ok) return parsed.response;
  const q = parsed.value;

  const now = new Date();
  const to = q.to ?? now;
  const defaultSpanMs = q.period === "week" ? 7 : 30;
  const from =
    q.from ?? new Date(to.getTime() - defaultSpanMs * 24 * 60 * 60 * 1000);

  const clinics = await prisma.clinic.findMany({
    select: { id: true, slug: true, nameRu: true, nameUz: true, active: true },
    orderBy: { nameRu: "asc" },
  });

  const range = { gte: from, lte: to };

  // Run the five group-bys in parallel. Each is keyed by clinicId.
  const [apptG, smsG, tgG, callG, patG] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { createdAt: range },
      _count: { _all: true },
    }),
    // Legacy historical SMS counter — see docstring above. The Prisma
    // enum still carries "SMS" (drop scheduled for Wave 5 of
    // `docs/TZ-sms-removal.md`), so this query continues to typecheck
    // and surfaces pre-Wave-3 rows. After Wave 5 it returns 0.
    prisma.notificationSend.groupBy({
      by: ["clinicId"],
      where: {
        channel: "SMS",
        createdAt: range,
        status: { in: ["SENT", "DELIVERED"] },
      },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["clinicId"],
      where: {
        createdAt: range,
        direction: "OUT",
      },
      _count: { _all: true },
    }),
    prisma.call.groupBy({
      by: ["clinicId"],
      where: { createdAt: range },
      _count: { _all: true },
    }),
    prisma.patient.groupBy({
      by: ["clinicId"],
      where: { createdAt: range },
      _count: { _all: true },
    }),
  ]);

  function toMap(rows: Array<{ clinicId: string; _count: { _all: number } }>) {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.clinicId, r._count._all);
    return m;
  }
  const apptMap = toMap(apptG);
  const smsMap = toMap(smsG);
  const tgMap = toMap(tgG);
  const callMap = toMap(callG);
  const patMap = toMap(patG);

  const rows = clinics.map((c) => ({
    clinicId: c.id,
    slug: c.slug,
    nameRu: c.nameRu,
    nameUz: c.nameUz,
    active: c.active,
    appointments: apptMap.get(c.id) ?? 0,
    smsSent: smsMap.get(c.id) ?? 0,
    tgMessages: tgMap.get(c.id) ?? 0,
    calls: callMap.get(c.id) ?? 0,
    patients: patMap.get(c.id) ?? 0,
  }));

  return ok({
    from: from.toISOString(),
    to: to.toISOString(),
    period: q.period,
    rows,
    totals: {
      appointments: rows.reduce((a, r) => a + r.appointments, 0),
      smsSent: rows.reduce((a, r) => a + r.smsSent, 0),
      tgMessages: rows.reduce((a, r) => a + r.tgMessages, 0),
      calls: rows.reduce((a, r) => a + r.calls, 0),
      patients: rows.reduce((a, r) => a + r.patients, 0),
    },
  });
});
