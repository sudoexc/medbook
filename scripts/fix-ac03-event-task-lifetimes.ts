/**
 * Audit AC-01 / AC-03 data fix: bring back event-driven Action Center tasks
 * the 48h `updatedAt` sweep erased, and give the live ones their lifetime.
 *
 * VISIT_FOLLOW_UP_DUE («контроль ~23.10») and LOW_NPS_RECEIVED («оценка
 * 3/10») are written once by the event that caused them. The engine never
 * refreshes them, so its 48h sweep marked them EXPIRED two days after
 * creation. Detector tasks heal themselves (the next engine pass reopens an
 * EXPIRED row whose signal still holds); these two never come back on their
 * own. The code fix gives both an explicit lifetime; this script applies the
 * same rules to rows written before it:
 *
 *   VISIT_FOLLOW_UP_DUE, expiresAt (due + 7 days) still ahead, status OPEN or
 *   EXPIRED. An EXPIRED one can only have come from the sweep, because its
 *   own deadline has not passed. Each is scheduled like a new task: hidden
 *   until 09:00 Tashkent a week before the due date, visible at once when
 *   that moment has passed. SNOOZED rows (a user snooze) and DONE / DISMISSED
 *   rows are left alone.
 *
 *   LOW_NPS_RECEIVED without expiresAt, status OPEN, SNOOZED or EXPIRED. It
 *   gets expiresAt = createdAt + 14 days. An EXPIRED one inside that window
 *   is reopened; older ones only get the stamp (and stay or become expired
 *   on the next engine pass).
 *
 *   PATIENT_NO_CHANNEL without expiresAt, status OPEN or SNOOZED. The 48h
 *   sweep now covers detector types only, and new rows carry their own
 *   lifetime (48h after the UTC day bucket). Rows written before that would
 *   otherwise never leave the list, so they get expiresAt 48h after the
 *   later of updatedAt and snoozeUntil, the moment the old sweep would have
 *   expired them. Rows already past it expire on the next engine pass, as
 *   they would have.
 *
 * Every row this script shows or schedules also gets `surfacedAt`: the
 * moment it (re)appears in the list, which is what the lists order by. A
 * reopened row surfaces now; a scheduled follow-up at its surface time.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-ac03-event-task-lifetimes.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-ac03-event-task-lifetimes.ts
 *
 * Idempotent: a second run finds every follow-up already in its scheduled
 * state and every low-NPS / no-channel row already carrying expiresAt.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { clinicMorningBefore } from "../src/server/actions/clinic-day";
import {
  LOW_NPS_ALERT_TTL_DAYS,
  PATIENT_NO_CHANNEL_TTL_HOURS,
  VISIT_FOLLOW_UP_LEAD_DAYS,
} from "../src/server/actions/config";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const DAY_MS = 24 * 60 * 60 * 1000;

type Change = {
  id: string;
  label: string;
  data: {
    status: string;
    snoozeUntil?: Date | null;
    expiresAt?: Date;
    surfacedAt?: Date;
  };
};

async function followUpChanges(now: Date): Promise<Change[]> {
  const rows = await prisma.action.findMany({
    where: {
      type: "VISIT_FOLLOW_UP_DUE",
      status: { in: ["OPEN", "EXPIRED"] },
      expiresAt: { gt: now },
    },
    select: { id: true, status: true, snoozeUntil: true, payload: true },
    orderBy: { createdAt: "asc" },
  });
  const changes: Change[] = [];
  for (const r of rows) {
    const p = r.payload as { dueDate?: string; patientName?: string };
    if (!p.dueDate) continue;
    const surfaceAt = clinicMorningBefore(p.dueDate, VISIT_FOLLOW_UP_LEAD_DAYS);
    const status = surfaceAt > now ? "SNOOZED" : "OPEN";
    const snoozeUntil = surfaceAt > now ? surfaceAt : null;
    const sameSnooze =
      (r.snoozeUntil?.getTime() ?? null) === (snoozeUntil?.getTime() ?? null);
    if (r.status === status && sameSnooze) continue;
    changes.push({
      id: r.id,
      label:
        `follow-up ${p.patientName ?? r.id} due ${p.dueDate}: ${r.status} → ${status}` +
        (snoozeUntil ? ` until ${snoozeUntil.toISOString()}` : ""),
      // Hidden until the surface time, or visible from now on.
      data: { status, snoozeUntil, surfacedAt: snoozeUntil ?? now },
    });
  }
  return changes;
}

async function lowNpsChanges(now: Date): Promise<Change[]> {
  const rows = await prisma.action.findMany({
    where: {
      type: "LOW_NPS_RECEIVED",
      status: { in: ["OPEN", "SNOOZED", "EXPIRED"] },
      expiresAt: null,
    },
    select: { id: true, status: true, createdAt: true, payload: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => {
    const p = r.payload as { patientName?: string; score?: number };
    const expiresAt = new Date(r.createdAt.getTime() + LOW_NPS_ALERT_TTL_DAYS * DAY_MS);
    const reopen = r.status === "EXPIRED" && expiresAt > now;
    const status = reopen ? "OPEN" : r.status;
    return {
      id: r.id,
      label:
        `low NPS ${p.patientName ?? r.id} (${p.score ?? "?"}/10): expires ${expiresAt.toISOString()}` +
        (reopen ? ", reopened" : ""),
      data: { status, expiresAt, ...(reopen ? { surfacedAt: now } : {}) },
    };
  });
}

async function noChannelChanges(): Promise<Change[]> {
  const rows = await prisma.action.findMany({
    where: {
      type: "PATIENT_NO_CHANNEL",
      status: { in: ["OPEN", "SNOOZED"] },
      expiresAt: null,
    },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      snoozeUntil: true,
      payload: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => {
    const p = r.payload as { patientName?: string; triggerKey?: string };
    // The old sweep counted its TTL from the later of both.
    const from = Math.max(r.updatedAt.getTime(), r.snoozeUntil?.getTime() ?? 0);
    const expiresAt = new Date(from + PATIENT_NO_CHANNEL_TTL_HOURS * 60 * 60 * 1000);
    return {
      id: r.id,
      label: `no channel ${p.patientName ?? r.id} (${p.triggerKey ?? "?"}): expires ${expiresAt.toISOString()}`,
      data: { status: r.status, expiresAt },
    };
  });
}

async function main() {
  const now = new Date();
  const changes = [
    ...(await followUpChanges(now)),
    ...(await lowNpsChanges(now)),
    ...(await noChannelChanges()),
  ];

  console.log(
    `┌─ ${APPLY ? "APPLY" : "DRY RUN"}: ${changes.length} event-driven Action Center tasks to fix`,
  );
  for (const c of changes) console.log(`  ${c.label}`);

  if (APPLY) {
    for (const c of changes) {
      await prisma.action.update({ where: { id: c.id }, data: c.data });
    }
    console.log(`└─ updated: ${changes.length}`);
  } else {
    console.log(
      `└─ would update: ${changes.length}. Nothing written; run again with APPLY=1`,
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
