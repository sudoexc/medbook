/**
 * Audit AN-02 data fix: file past payments under the visit they paid for.
 *
 * The patient card's payment dialog never sent `appointmentId`, so every
 * payment taken in the CRM hangs off the patient only. Everything counted
 * per visit reads nothing: the doctor's revenue and «Топ врачей», the visit
 * drawer's payments, the «Неоплаченные» filter, the paid-visit price lock.
 *
 * A payment is linked only when the match is unambiguous: the patient has
 * exactly ONE visit (not cancelled, not a no-show) on the Tashkent day the
 * money was taken (`paidAt`, else `createdAt`), and that visit has no
 * payment filed under it yet. Every payment of that patient on that day
 * goes to that visit (a split payment is still one visit). Anything else
 * (no visit that day, two visits, a visit already paid) is listed and left
 * for a person to decide in the CRM. Each link writes a
 * `payment.visit_linked` audit row (`triggeredBy: "backfill_an02"`).
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-an02-link-payments-to-visits.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-an02-link-payments-to-visits.ts
 *
 * Idempotent: only payments without a visit are considered.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { tashkentPartsOf } from "../src/lib/tashkent-time";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

/** Tashkent is UTC+5 with no DST. */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** UTC bounds of a Tashkent calendar day `YYYY-MM-DD`. */
function dayBounds(day: string): { gte: Date; lt: Date } {
  const start = new Date(`${day}T00:00:00.000Z`).getTime() - TASHKENT_OFFSET_MS;
  return { gte: new Date(start), lt: new Date(start + 24 * 60 * 60 * 1000) };
}

async function main() {
  const unlinked = await prisma.payment.findMany({
    where: { appointmentId: null, patientId: { not: null } },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      amount: true,
      status: true,
      paidAt: true,
      createdAt: true,
      patient: { select: { fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // One decision per patient and Tashkent day.
  const groups = new Map<string, typeof unlinked>();
  for (const p of unlinked) {
    const day = tashkentPartsOf(p.paidAt ?? p.createdAt).date;
    const key = `${p.patientId}|${day}`;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${unlinked.length} payments without a visit, ${groups.size} patient-days`,
  );

  let linked = 0;
  const skipped = { noVisit: 0, severalVisits: 0, visitAlreadyPaid: 0 };
  for (const [key, payments] of groups) {
    const [patientId, day] = key.split("|");
    const who = payments[0].patient?.fullName ?? patientId;
    const visits = await prisma.appointment.findMany({
      where: {
        patientId,
        clinicId: payments[0].clinicId,
        date: dayBounds(day),
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      select: { id: true, date: true, _count: { select: { payments: true } } },
    });
    if (visits.length === 0) {
      skipped.noVisit += payments.length;
      continue;
    }
    if (visits.length > 1) {
      skipped.severalVisits += payments.length;
      console.log(`  ? ${day} ${who}: ${visits.length} visits that day, left for staff`);
      continue;
    }
    const visit = visits[0];
    if (visit._count.payments > 0) {
      skipped.visitAlreadyPaid += payments.length;
      console.log(`  ? ${day} ${who}: the visit already has a payment, left for staff`);
      continue;
    }

    linked += payments.length;
    console.log(
      `  ${day} ${who}: ${payments.length} payment(s), ` +
        `${payments.reduce((a, p) => a + p.amount, 0) / 100} сум → visit ${visit.id}`,
    );
    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      for (const p of payments) {
        await tx.payment.update({
          where: { id: p.id },
          data: { appointmentId: visit.id },
        });
        await tx.auditLog.create({
          data: {
            clinicId: p.clinicId,
            actorId: null,
            actorRole: "SYSTEM",
            actorLabel: "backfill:an02",
            action: "payment.visit_linked",
            entityType: "Payment",
            entityId: p.id,
            meta: {
              appointmentId: visit.id,
              day,
              triggeredBy: "backfill_an02",
            } as never,
            ip: null,
            userAgent: null,
            surface: "WORKER",
          },
        });
      }
    });
  }

  console.log(
    `│ skipped: no visit that day ${skipped.noVisit}, several visits ${skipped.severalVisits}, ` +
      `visit already paid ${skipped.visitAlreadyPaid}`,
  );
  console.log(
    `└─ ${APPLY ? "linked" : "would link"}: ${linked}` +
      (APPLY ? "" : ". Nothing written; run again with APPLY=1"),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
