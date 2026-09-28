/**
 * Audit AC-09 data fix: bring back the calls reception promised patients
 * before the fix, which the old code dropped.
 *
 * «Перезвонить позже» and «Хочет прийти позже» only snoozed the visit's risk
 * rows (NO_SHOW_RISK_HIGH, UNCONFIRMED_24H, NO_CONTACT_CALL) until the
 * promised time. Those rows die with the visit, so a promise set past the
 * visit was swept as EXPIRED before it came due, or is about to be. New
 * outcomes hand such a promise to a PATIENT_CALLBACK task; this script does
 * the same for the ones recorded before:
 *
 *   A risk row, SNOOZED or EXPIRED, with outcome CALLBACK / RETURN_LATER and
 *   a callback time at or after its visit (the same test the outcome
 *   endpoints now apply, `callbackOutlivesVisit`), promised within the last
 *   LOOKBACK_DAYS or later. An EXPIRED one was lost already; a SNOOZED one is
 *   about to be. A promise that is overdue now surfaces at once. A callback
 *   set before the visit is left alone: its row did come back in time.
 *   One task per visit (the latest outcome wins), not created again when the
 *   visit already has a PATIENT_CALLBACK task. A still-SNOOZED source row is
 *   closed as DONE, the state a handed-off row gets now, dated when its
 *   outcome was recorded (so it does not show up in today's «Обработано
 *   сегодня»); EXPIRED rows stay as they are.
 *
 * Appointments are NOT touched: a RETURN_LATER recorded before the fix left
 * its visit BOOKED, and by now that visit is in the past and the lifecycle
 * sweep has settled it. Reception sees the call task and books the patient.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-ac09-lost-callbacks.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-ac09-lost-callbacks.ts
 *
 * Idempotent: a second run finds a PATIENT_CALLBACK task for every visit it
 * handled and no SNOOZED source row left.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  RISK_ACTION_TYPES,
  dedupeKeyFor,
  type PatientCallbackPayload,
} from "../src/lib/actions/types";
import { clinicMorningOf } from "../src/server/actions/clinic-day";
import { upsertAction } from "../src/server/actions/repository";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const DAY_MS = 24 * 60 * 60 * 1000;
/** A promise older than this is no longer worth a call task. */
const LOOKBACK_DAYS = 14;

type Source = {
  id: string;
  clinicId: string;
  type: string;
  status: string;
  outcome: string | null;
  outcomeNote: string | null;
  callbackAt: Date | null;
  expiresAt: Date | null;
  updatedAt: Date;
  payload: unknown;
};

type Plan = {
  clinicId: string;
  appointmentId: string;
  payload: PatientCallbackPayload;
  surfaceAt: Date;
  /** False when the visit already has its task (a rerun). */
  createTask: boolean;
  close: Array<{ id: string; doneAt: Date }>;
  label: string;
};

async function plans(now: Date): Promise<Plan[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const rows = (await prisma.action.findMany({
    where: {
      type: { in: [...RISK_ACTION_TYPES] },
      outcome: { in: ["CALLBACK", "RETURN_LATER"] },
      callbackAt: { gte: since },
      status: { in: ["SNOOZED", "EXPIRED"] },
    },
    select: {
      id: true,
      clinicId: true,
      type: true,
      status: true,
      outcome: true,
      outcomeNote: true,
      callbackAt: true,
      expiresAt: true,
      updatedAt: true,
      payload: true,
    },
    orderBy: { updatedAt: "asc" },
  })) as Source[];

  // Only the promises the old code loses: set at or after the visit.
  const visitAt = (r: Source): Date | null => {
    const at = (r.payload as { appointmentAt?: string }).appointmentAt;
    return at ? new Date(at) : r.expiresAt;
  };
  const lost = rows.filter((r) => {
    const visit = visitAt(r);
    return visit != null && r.callbackAt!.getTime() >= visit.getTime();
  });

  // One task per visit; rows are ordered oldest first, so the latest outcome
  // overwrites the earlier ones.
  const byVisit = new Map<string, { latest: Source; all: Source[] }>();
  for (const r of lost) {
    const apptId = (r.payload as { appointmentId?: string }).appointmentId;
    if (!apptId) continue;
    const key = `${r.clinicId}:${apptId}`;
    const entry = byVisit.get(key) ?? { latest: r, all: [] };
    entry.latest = r;
    entry.all.push(r);
    byVisit.set(key, entry);
  }

  const out: Plan[] = [];
  for (const { latest, all } of byVisit.values()) {
    const apptId = (latest.payload as { appointmentId: string }).appointmentId;
    const appt = await prisma.appointment.findUnique({
      where: { id: apptId },
      select: {
        id: true,
        date: true,
        patientId: true,
        patient: { select: { fullName: true } },
        doctor: { select: { nameRu: true } },
      },
    });
    if (!appt) continue;
    const reason = latest.outcome === "RETURN_LATER" ? "RETURN_LATER" : "CALLBACK";
    const callbackAt =
      reason === "RETURN_LATER" ? clinicMorningOf(latest.callbackAt!) : latest.callbackAt!;
    const payload: PatientCallbackPayload = {
      type: "PATIENT_CALLBACK",
      appointmentId: appt.id,
      patientId: appt.patientId,
      patientName: appt.patient.fullName,
      doctorName: appt.doctor?.nameRu ?? "",
      appointmentAt: appt.date.toISOString(),
      reason,
      callbackAt: callbackAt.toISOString(),
      note: latest.outcomeNote ?? "",
    };
    const existing = await prisma.action.findUnique({
      where: {
        clinicId_dedupeKey: { clinicId: latest.clinicId, dedupeKey: dedupeKeyFor(payload) },
      },
      select: { id: true },
    });
    const close = all
      .filter((r) => r.status === "SNOOZED")
      .map((r) => ({ id: r.id, doneAt: r.updatedAt }));
    if (existing && close.length === 0) continue;
    out.push({
      clinicId: latest.clinicId,
      appointmentId: appt.id,
      payload,
      // An overdue promise surfaces now; `upsertAction` treats a past surface
      // time as «show at once».
      surfaceAt: callbackAt,
      createTask: !existing,
      close,
      label:
        `${reason} ${appt.patient.fullName} (visit ${appt.date.toISOString()}): ` +
        (existing
          ? "task exists, closing its snoozed source rows"
          : `call ${callbackAt.toISOString()}${callbackAt < now ? " (overdue, shows now)" : ""}`) +
        (latest.outcomeNote ? ` «${latest.outcomeNote}»` : ""),
    });
  }
  return out;
}

async function main() {
  const now = new Date();
  const todo = await plans(now);

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${todo.length} promised calls to restore as PATIENT_CALLBACK tasks`,
  );
  for (const p of todo) console.log(`  ${p.label}`);

  if (APPLY) {
    for (const p of todo) {
      if (p.createTask) {
        await upsertAction(prisma as never, p.clinicId, p.payload, {
          deeplinkPath: `/crm/patients/${p.payload.patientId}`,
          surfaceAt: p.surfaceAt,
          expiresAt: null,
        });
      }
      for (const c of p.close) {
        await prisma.action.updateMany({
          where: { id: c.id, status: "SNOOZED" },
          data: { status: "DONE", doneAt: c.doneAt },
        });
      }
    }
    console.log(`└─ restored: ${todo.length}`);
  } else {
    console.log(`└─ would restore: ${todo.length}. Nothing written; run again with APPLY=1`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
