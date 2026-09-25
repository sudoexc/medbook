/**
 * Audit PT-02 backfill: re-price Mini App bookings that were filed under a
 * medical case without the free-repeat rule.
 *
 * Until the fix, a Mini App booking auto-attached to the patient's open case
 * (or attached by the patient's own pick) kept its full price, while the same
 * attach from the CRM made a follow-up inside the service's `freeRepeatDays`
 * free. This finds the TELEGRAM-channel visits already in a case, still
 * unpaid and not cancelled / no-show, and runs the same pricing engine the
 * CRM uses (`recomputeAppointmentPrice`).
 *
 * Conservative on purpose: a visit is changed ONLY when the engine makes it
 * cheaper under the free-repeat rule. Anything else (no change, a higher
 * price, a paid visit) is left exactly as it is. Each visit runs in its own
 * transaction, rolled back unless it qualifies AND APPLY=1, so the dry run
 * prints the exact prices the apply would write. Applied visits get the same
 * `appointment.free_repeat_applied` audit row as the CRM attach
 * (`triggeredBy: "backfill_pt02"`).
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/backfill-miniapp-free-repeat.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/backfill-miniapp-free-repeat.ts
 *
 * Idempotent: a visit already priced by the rule is «no change» and skipped.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  recomputeAppointmentPrice,
  type RecomputeResult,
} from "../src/server/pricing/recompute-appointment-price";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

/** Thrown to roll a per-visit transaction back while keeping its result. */
class Rollback extends Error {
  constructor(readonly result: RecomputeResult | null) {
    super("rollback");
  }
}

async function main() {
  const candidates = await prisma.appointment.findMany({
    where: {
      channel: "TELEGRAM",
      medicalCaseId: { not: null },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      payments: { none: { status: "PAID" } },
    },
    select: {
      id: true,
      clinicId: true,
      date: true,
      status: true,
      priceFinal: true,
      medicalCaseId: true,
      patient: { select: { fullName: true } },
    },
    orderBy: { date: "asc" },
  });

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${candidates.length} unpaid Mini App visits in a case`,
  );

  let changed = 0;
  for (const appt of candidates) {
    let result: RecomputeResult | null = null;
    try {
      result = await prisma.$transaction(async (tx) => {
        const r = await recomputeAppointmentPrice(tx as never, appt.id);
        const before = appt.priceFinal ?? 0;
        const qualifies =
          r.reason === "free_repeat" && (r.priceFinal ?? 0) < before;
        if (!qualifies || !APPLY) throw new Rollback(qualifies ? r : null);
        await tx.auditLog.create({
          data: {
            clinicId: appt.clinicId,
            actorId: null,
            actorRole: "SYSTEM",
            actorLabel: "backfill:pt02",
            action: "appointment.free_repeat_applied",
            entityType: "Appointment",
            entityId: appt.id,
            meta: {
              caseId: appt.medicalCaseId,
              daysFromFirst: r.daysFromFirst,
              savedAmount: r.savedAmount,
              trace: r.trace,
              triggeredBy: "backfill_pt02",
              priceBefore: before,
            } as never,
            ip: null,
            userAgent: null,
            surface: "WORKER",
          },
        });
        return r;
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
      result = e.result;
    }
    if (!result) continue;
    changed += 1;
    console.log(
      `  ${appt.date.toISOString().slice(0, 16)} ${appt.status.padEnd(11)} ` +
        `${appt.patient.fullName}: ${appt.priceFinal ?? 0} → ${result.priceFinal ?? 0} ` +
        `(день ${result.daysFromFirst} от первого визита)`,
    );
  }

  console.log(
    `└─ ${APPLY ? "re-priced" : "would re-price"}: ${changed}` +
      (APPLY ? "" : ". Nothing written; run again with APPLY=1"),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
