/**
 * Audit TG-11 data fix: bot threads and patient cards that never met.
 *
 * Until the fix the webhook never looked a sender's card up, and linking a
 * thread from the inbox wrote only `Conversation.patientId`. Two kinds of
 * rows were left behind; a private chat's id IS the Telegram user's id, so
 * both are recognisable:
 *
 *   1. An unlinked TG thread whose chat id is a live card's telegramId: the
 *      patient wrote from the account his card is bound to, and the inbox
 *      showed an «unknown contact». The thread is tied to that card, as the
 *      webhook does today. When that card is the Mini App's unconfirmed
 *      stub, the inbox's right rail offers to move the chat to the clinic
 *      card (audit TG-11 review).
 *   2. A TG thread reception linked to a card that has no telegramId: the
 *      card never learned the account, so reminders went to the Action
 *      Center as «нет канала». The card gets the account, under the same
 *      rules as a link made today: never when another card holds it (listed
 *      for reception, nothing moved), never when one card has two candidate
 *      accounts or one account two candidate cards (ambiguous, listed).
 *      Those links were made when linking only grouped the inbox, often for
 *      a relative writing about a patient, so the account is written only
 *      onto a card with no history whose name the Telegram profile goes by.
 *      Every other card is listed under CONFIRM and left without Telegram:
 *      reception checks who writes and binds it from the chat's right rail
 *      («Привязать этот Telegram»), which warns what the account will see.
 *
 * Nothing else changes: no card is retired or merged, no message is sent.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-tg11-thread-patient-links.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-tg11-thread-patient-links.ts
 *
 * Idempotent: a linked thread is no longer unlinked, a card with a
 * telegramId no longer lacks one.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  goesByCardName,
  isPrivateChatId,
  threadProfileName,
} from "../src/lib/patients/telegram-card";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

/**
 * Same rule as `cardHoldsHistory` in src/server/telegram/contact-verify.ts:
 * any visit, note or document.
 */
async function cardHoldsHistory(patientId: string): Promise<boolean> {
  const row = await prisma.patient.findFirst({
    where: { id: patientId },
    select: {
      _count: { select: { appointments: true, visitNotes: true, documents: true } },
    },
  });
  if (!row) return true;
  return Object.values(row._count).some((n) => n > 0);
}

async function linkUnlinkedThreads(): Promise<void> {
  const threads = await prisma.conversation.findMany({
    where: { channel: "TG", patientId: null, externalId: { not: null } },
    select: { id: true, clinicId: true, externalId: true },
  });
  let linked = 0;
  console.log(`┌─ 1. unlinked TG threads: ${threads.length}`);
  for (const th of threads) {
    if (!th.externalId || !isPrivateChatId(th.externalId)) continue;
    const card = await prisma.patient.findFirst({
      where: { clinicId: th.clinicId, telegramId: th.externalId, deletedAt: null },
      select: { id: true, fullName: true },
    });
    if (!card) continue;
    console.log(`│  thread ${th.id} → ${card.fullName} (${card.id})`);
    if (APPLY) {
      const res = await prisma.conversation.updateMany({
        where: { id: th.id, patientId: null },
        data: { patientId: card.id },
      });
      linked += res.count;
    } else {
      linked += 1;
    }
  }
  console.log(`└─ ${APPLY ? "linked" : "would link"}: ${linked}`);
}

async function teachCardsTheirAccount(): Promise<void> {
  const threads = await prisma.conversation.findMany({
    where: {
      channel: "TG",
      externalId: { not: null },
      patient: { telegramId: null, deletedAt: null },
    },
    select: {
      id: true,
      clinicId: true,
      externalId: true,
      contactUsername: true,
      contactFirstName: true,
      contactLastName: true,
      patientId: true,
      patient: { select: { fullName: true, telegramLinkedAt: true } },
    },
  });

  type Candidate = {
    clinicId: string;
    patientId: string;
    fullName: string;
    telegramLinkedAt: Date | null;
    telegramId: string;
    username: string | null;
    profileName: string | null;
  };
  const byCard = new Map<string, Candidate[]>();
  const cardsByAccount = new Map<string, Set<string>>();
  for (const th of threads) {
    if (!th.patientId || !th.patient || !th.externalId) continue;
    if (!isPrivateChatId(th.externalId)) continue;
    const c: Candidate = {
      clinicId: th.clinicId,
      patientId: th.patientId,
      fullName: th.patient.fullName,
      telegramLinkedAt: th.patient.telegramLinkedAt,
      telegramId: th.externalId,
      username: th.contactUsername,
      profileName: threadProfileName(th),
    };
    byCard.set(c.patientId, [...(byCard.get(c.patientId) ?? []), c]);
    const accountKey = `${c.clinicId}:${c.telegramId}`;
    const cards = cardsByAccount.get(accountKey) ?? new Set<string>();
    cards.add(c.patientId);
    cardsByAccount.set(accountKey, cards);
  }

  console.log(`┌─ 2. cards linked to a bot thread but without telegramId: ${byCard.size}`);
  let written = 0;
  const toConfirm: string[] = [];
  for (const [patientId, candidates] of byCard) {
    const accounts = new Set(candidates.map((c) => c.telegramId));
    const c = candidates[0]!;
    if (accounts.size > 1) {
      console.log(`│  SKIP ${c.fullName} (${patientId}): threads of ${accounts.size} different accounts`);
      continue;
    }
    if ((cardsByAccount.get(`${c.clinicId}:${c.telegramId}`)?.size ?? 0) > 1) {
      console.log(`│  SKIP ${c.fullName} (${patientId}): account ${c.telegramId} is linked to several cards`);
      continue;
    }
    const holder = await prisma.patient.findFirst({
      where: { clinicId: c.clinicId, telegramId: c.telegramId },
      select: { id: true, fullName: true },
    });
    if (holder) {
      console.log(
        `│  CONFLICT ${c.fullName} (${patientId}): account ${c.telegramId} sits on «${holder.fullName}» (${holder.id}); reception compares the cards`,
      );
      continue;
    }
    // The link was reception's call about whose conversation it is, not
    // proof whose Telegram it is: a card with history, or one the profile
    // does not go by, is never handed to the account by this script.
    if (await cardHoldsHistory(patientId)) {
      toConfirm.push(`${c.fullName} (${patientId}): card has history; account ${c.telegramId} «${c.profileName ?? "?"}»`);
      continue;
    }
    if (!goesByCardName(candidates.map((x) => x.profileName), c.fullName)) {
      toConfirm.push(`${c.fullName} (${patientId}): Telegram profile «${c.profileName ?? "?"}» (${c.telegramId}) goes by another name`);
      continue;
    }
    console.log(`│  ${c.fullName} (${patientId}) ← telegram ${c.telegramId}`);
    if (!APPLY) {
      written += 1;
      continue;
    }
    try {
      const res = await prisma.patient.updateMany({
        where: { id: patientId, telegramId: null },
        data: {
          telegramId: c.telegramId,
          ...(c.username ? { telegramUsername: c.username } : {}),
          ...(c.telegramLinkedAt ? {} : { telegramLinkedAt: new Date() }),
        },
      });
      if (res.count > 0) {
        written += 1;
        await prisma.auditLog.create({
          data: {
            clinicId: c.clinicId,
            action: "patient.telegram.inbox_linked",
            entityType: "Patient",
            entityId: patientId,
            meta: { telegramId: c.telegramId, source: "fix-tg11" },
          },
        });
      }
    } catch (e) {
      // The unique (clinicId, telegramId) index: someone took the account
      // meanwhile. Left for reception, like any other conflict.
      console.log(`│  SKIP ${c.fullName} (${patientId}): ${(e as Error).message.split("\n")[0]}`);
    }
  }
  console.log(`└─ ${APPLY ? "written" : "would write"}: ${written}`);
  console.log(`┌─ CONFIRM in the inbox (nothing written): ${toConfirm.length}`);
  for (const line of toConfirm) console.log(`│  ${line}`);
  console.log(`└─ reception opens each chat and uses «Привязать этот Telegram» if it is the patient`);
}

async function main() {
  console.log(APPLY ? "APPLY" : "DRY RUN (nothing is written; run again with APPLY=1)");
  await linkUnlinkedThreads();
  await teachCardsTheirAccount();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
