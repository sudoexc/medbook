/**
 * Follow-up of migration 20260925200000_patient_phone_verified_tg_unique
 * (audit PH-01, MA-04). Run AFTER that migration is deployed.
 *
 * 1. Telegram accounts that were bound to two cards. The migration kept one
 *    card per (clinic, telegramId) and unlinked the others, writing one
 *    `patient.telegram.dedupe_unlinked` audit row each. For every such card:
 *      - an empty auto-created card (born in the Mini App, no visits,
 *        documents, family links…) is retired: soft-deleted, stripped of its
 *        `tg:` stub, marked `duplicate_of:<keeper>`;
 *      - a card with history gets a TELEGRAM_LINK_CONFLICT task in the
 *        Action Center, so reception compares the two cards and merges them
 *        by hand. Nothing clinical is moved automatically.
 *
 * 2. Numbers typed into the Mini App on a clinic card. The migration marked
 *    every staff-created card's number as verified, but a patient could
 *    later have changed it in the Mini App profile (audited as
 *    `event:patient.profileUpdated` with `phone` among changedFields). When
 *    that change is newer than any staff edit of the number, the number is
 *    only a claim again: `phoneVerifiedAt` is cleared so walk-in, kiosk and
 *    CRM lookups stop trusting it. (The booking form also wrote phones
 *    without an audit trail; those cannot be told apart and stay as they
 *    are.)
 *
 * Dry run by default: prints what it would do and writes nothing.
 *   docker compose exec -T worker npx tsx scripts/fix-patient-telegram-identity.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-patient-telegram-identity.ts
 *
 * Idempotent: retired cards are skipped, conflict tasks are upserted on their
 * dedupe key, and a cleared `phoneVerifiedAt` is not cleared again.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  dedupeKeyFor,
  defaultAssigneeRole,
  defaultSeverity,
  type TelegramLinkConflictPayload,
} from "../src/lib/actions/types";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1" || process.argv.includes("--apply");

type DedupeMeta = { telegramId?: string; keeperId?: string };

/**
 * Same rule as `isRetirableAutoCard` in src/server/patient/phone-identity.ts
 * (not imported: that module pulls the tenant-scoped client in).
 */
async function isRetirable(patientId: string): Promise<boolean> {
  const row = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      source: true,
      phoneVerifiedAt: true,
      _count: {
        select: {
          appointments: true,
          visitNotes: true,
          documents: true,
          payments: true,
          cases: true,
          prescriptions: true,
          ePrescriptions: true,
          sickLeaves: true,
          referrals: true,
          labOrders: true,
          labResults: true,
          allergies: true,
          chronicConditions: true,
          diagnoses: true,
          ownedFamilyLinks: true,
          linkedFamilyLinks: true,
          onlineRequests: true,
        },
      },
    },
  });
  if (!row) return false;
  if (row.source !== "TELEGRAM" || row.phoneVerifiedAt !== null) return false;
  return Object.values(row._count).every((n) => n === 0);
}

async function fixDedupedCards(now: Date) {
  const rows = await prisma.auditLog.findMany({
    where: { action: "patient.telegram.dedupe_unlinked", entityType: "Patient" },
    orderBy: { createdAt: "asc" },
    select: { clinicId: true, entityId: true, meta: true },
  });
  console.log(`┌─ ${rows.length} карт, у которых миграция сняла дублирующий Telegram`);

  let retired = 0;
  let tasks = 0;
  for (const row of rows) {
    if (!row.entityId || !row.clinicId) continue;
    const meta = (row.meta ?? {}) as DedupeMeta;
    const card = await prisma.patient.findUnique({
      where: { id: row.entityId },
      select: { id: true, fullName: true, deletedAt: true, patientNumber: true },
    });
    if (!card || card.deletedAt) continue;
    const keeper = meta.keeperId
      ? await prisma.patient.findUnique({
          where: { id: meta.keeperId },
          select: { id: true, fullName: true },
        })
      : null;
    if (!keeper) continue;

    if (await isRetirable(card.id)) {
      retired += 1;
      console.log(`  · пустая авто-карта P-${card.patientNumber} «${card.fullName}» → убрать (дубль «${keeper.fullName}»)`);
      if (APPLY) {
        await prisma.patient.update({
          where: { id: card.id },
          // Same payload as retiredCardData() in phone-identity.ts.
          data: {
            telegramId: null,
            telegramUsername: null,
            phone: "",
            phoneNormalized: `retired:${card.id}`,
            phoneVerifiedAt: null,
            deletedAt: now,
            deletionReason: `duplicate_of:${keeper.id}`,
          },
        });
      }
      continue;
    }

    tasks += 1;
    console.log(`  · P-${card.patientNumber} «${card.fullName}» с историей → задача ресепшену (Telegram остался у «${keeper.fullName}»)`);
    if (APPLY) {
      const payload: TelegramLinkConflictPayload = {
        type: "TELEGRAM_LINK_CONFLICT",
        telegramCardId: keeper.id,
        telegramCardName: keeper.fullName,
        clinicCardId: card.id,
        clinicCardName: card.fullName,
        via: "dedupe",
      };
      const dedupeKey = dedupeKeyFor(payload);
      await prisma.action.upsert({
        where: { clinicId_dedupeKey: { clinicId: row.clinicId, dedupeKey } },
        create: {
          clinicId: row.clinicId,
          type: payload.type,
          severity: defaultSeverity(payload.type),
          payload,
          assigneeRole: defaultAssigneeRole(payload.type),
          deeplinkPath: `/crm/patients/${card.id}`,
          dedupeKey,
        },
        update: {},
      });
    }
  }
  console.log(`└─ убрать пустых: ${retired}, задач ресепшену: ${tasks}`);
}

type EnvelopeMeta = { payload?: { changedFields?: unknown } };

async function unverifyMiniAppPhones() {
  const miniAppEdits = await prisma.auditLog.findMany({
    where: { action: "event:patient.profileUpdated", entityType: "Patient" },
    select: { entityId: true, createdAt: true, meta: true },
  });
  const lastMiniAppPhone = new Map<string, Date>();
  for (const e of miniAppEdits) {
    const fields = (e.meta as EnvelopeMeta | null)?.payload?.changedFields;
    if (!e.entityId || !Array.isArray(fields) || !fields.includes("phone")) continue;
    const prev = lastMiniAppPhone.get(e.entityId);
    if (!prev || prev < e.createdAt) lastMiniAppPhone.set(e.entityId, e.createdAt);
  }
  console.log(`┌─ ${lastMiniAppPhone.size} карт, где номер меняли в мини-аппе`);

  let cleared = 0;
  for (const [patientId, miniAppAt] of lastMiniAppPhone) {
    const card = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, fullName: true, phone: true, phoneVerifiedAt: true, patientNumber: true },
    });
    if (!card || card.phoneVerifiedAt === null) continue;
    // A later staff edit of the number (CRM PATCH audits `diff()`:
    // `{ before: {...}, after: {...} }` with only the changed fields) makes
    // it the clinic's own record again.
    const staffEdits = await prisma.auditLog.findMany({
      where: {
        entityType: "Patient",
        entityId: patientId,
        action: "patient.update",
        createdAt: { gt: miniAppAt },
      },
      select: { meta: true },
    });
    const staffTouchedPhone = staffEdits.some((e) => {
      const after = (e.meta as { after?: Record<string, unknown> } | null)?.after;
      return !!after && ("phone" in after || "phoneNormalized" in after);
    });
    if (staffTouchedPhone) continue;
    cleared += 1;
    console.log(`  · P-${card.patientNumber} «${card.fullName}» ${card.phone}: номер из мини-аппа → снять подтверждение`);
    if (APPLY) {
      await prisma.patient.update({
        where: { id: patientId },
        data: { phoneVerifiedAt: null },
      });
    }
  }
  console.log(`└─ снять подтверждение: ${cleared}`);
}

async function main() {
  console.log(APPLY ? "APPLY: изменения будут записаны\n" : "DRY RUN: ничего не пишется (APPLY=1 чтобы применить)\n");
  const now = new Date();
  await fixDedupedCards(now);
  console.log("");
  await unverifyMiniAppPhones();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
