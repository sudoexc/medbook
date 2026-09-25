/**
 * Consume a `TelegramInviteToken` from the bot webhook.
 *
 * Flow on the Telegram side:
 *   1. Staff member opens the patient card → POSTs to
 *      `/api/crm/patients/[id]/telegram-invite` → receives
 *      `t.me/<bot>?start=<token>` and shares it with the patient.
 *   2. The patient taps the link in Telegram. The client sends
 *      `/start <token>` to the bot.
 *   3. The clinic-scoped webhook (`/api/telegram/webhook/[clinicSlug]`)
 *      parses the payload, calls `consumeInviteToken(...)`, then runs
 *      the regular FSM welcome.
 *
 * Responsibilities of `consumeInviteToken`:
 *   - Look up the row by `token` under the system context (no tenant
 *     scoping — the webhook does not run in a TENANT context).
 *   - Reject if expired or already consumed.
 *   - Refuse to cross-link a token from clinic A onto a webhook firing
 *     for clinic B (defence in depth — the slug-pinned webhook is
 *     already isolated, but we double-check at the data layer).
 *   - Stamp `Patient.telegramId` (and `telegramUsername` when present).
 *     Skipped when the patient already carries a different telegramId —
 *     we do NOT silently overwrite an existing link.
 *   - One card per Telegram account (audit MA-04). A returning patient who
 *     opened the bot before scanning the invite already has an empty card
 *     the Mini App created on first open; that card is retired in the same
 *     transaction so the Mini App stops flip-flopping between the two. If
 *     the account's other card holds real history, nothing is relinked:
 *     reception gets a TELEGRAM_LINK_CONFLICT task and the token stays
 *     unconsumed for a retry after the merge.
 *   - Stamp `consumedAt` + `consumedTelegramId` on the token row.
 *   - Emit one audit row (`patient.telegram.invite_consumed`).
 *
 * Returns a small discriminated union the caller logs/emits as desired.
 * Side-effects are best-effort — a failure here MUST NOT abort the
 * welcome message (we still want the patient to see the bot reply).
 */
import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import {
  isRetirableAutoCard,
  isUniqueViolation,
  retiredCardData,
} from "@/server/patient/phone-identity";
import { raiseTelegramLinkConflict } from "@/server/patient/telegram-link-conflict";

export type InviteConsumeResult =
  | {
      kind: "linked";
      patientId: string;
      tokenId: string;
      /** The empty auto-created card this account left behind, if any. */
      retiredPatientId?: string | null;
    }
  | {
      kind: "telegram-has-other-card";
      tokenId: string;
      patientId: string;
      otherPatientId: string;
    }
  | { kind: "already-consumed"; tokenId: string }
  | { kind: "expired"; tokenId: string }
  | { kind: "patient-already-linked"; tokenId: string; patientId: string }
  | { kind: "wrong-clinic"; tokenId: string; expectedClinicId: string }
  | { kind: "not-found" };

export interface ConsumeInviteTokenInput {
  clinicId: string;
  token: string;
  telegramId: string;
  telegramUsername?: string | null;
  now?: Date;
}

export async function consumeInviteToken(
  input: ConsumeInviteTokenInput,
): Promise<InviteConsumeResult> {
  const now = input.now ?? new Date();

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const row = await prisma.telegramInviteToken.findUnique({
      where: { token: input.token },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
    if (!row) return { kind: "not-found" };

    if (row.clinicId !== input.clinicId) {
      return {
        kind: "wrong-clinic",
        tokenId: row.id,
        expectedClinicId: row.clinicId,
      };
    }
    if (row.consumedAt) {
      return { kind: "already-consumed", tokenId: row.id };
    }
    if (row.expiresAt <= now) {
      return { kind: "expired", tokenId: row.id };
    }

    const patient = await prisma.patient.findFirst({
      where: { id: row.patientId, clinicId: input.clinicId },
      select: { id: true, fullName: true, telegramId: true },
    });
    if (!patient) {
      // The patient row vanished (cascade deletes wipe the token too,
      // but we guard against races just in case).
      return { kind: "not-found" };
    }
    if (patient.telegramId && patient.telegramId !== input.telegramId) {
      // The patient was linked to a different Telegram account in the
      // meantime — refuse to overwrite. The bot greets them as normal;
      // staff sees the audit row and can chase the discrepancy.
      return { kind: "patient-already-linked", tokenId: row.id, patientId: patient.id };
    }

    // The account may already own another card here — typically the empty
    // one the Mini App created when the patient first opened the bot.
    const other = patient.telegramId
      ? null
      : await prisma.patient.findFirst({
          where: {
            clinicId: input.clinicId,
            telegramId: input.telegramId,
            id: { not: patient.id },
          },
          select: { id: true, fullName: true },
        });
    let retiredPatientId: string | null = null;
    if (other) {
      if (!(await isRetirableAutoCard(prisma, other.id))) {
        await raiseTelegramLinkConflict({
          clinicId: input.clinicId,
          telegramId: input.telegramId,
          telegramCard: other,
          clinicCard: { id: patient.id, fullName: patient.fullName },
          via: "invite",
        });
        return {
          kind: "telegram-has-other-card",
          tokenId: row.id,
          patientId: patient.id,
          otherPatientId: other.id,
        };
      }
      retiredPatientId = other.id;
    }

    try {
      await prisma.$transaction([
        // Retire first: the account's id must be free before the invited
        // card takes it (one card per account is a unique index).
        ...(other
          ? [
              prisma.patient.update({
                where: { id: other.id },
                data: retiredCardData(patient.id, other.id, now),
              }),
            ]
          : []),
        prisma.patient.update({
          where: { id: patient.id },
          data: {
            telegramId: input.telegramId,
            telegramUsername: input.telegramUsername ?? undefined,
            // First-link timestamp — drives the "+N за неделю" trend. Never overwrite.
            ...(patient.telegramId ? {} : { telegramLinkedAt: now }),
          },
        }),
        prisma.telegramInviteToken.update({
          where: { id: row.id },
          data: {
            consumedAt: now,
            consumedTelegramId: input.telegramId,
          },
        }),
      ]);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // A concurrent first open of the Mini App bound the account to a new
      // card between the lookup and the write. Leave the token for a retry.
      const raced = await prisma.patient.findFirst({
        where: { clinicId: input.clinicId, telegramId: input.telegramId },
        select: { id: true },
      });
      return {
        kind: "telegram-has-other-card",
        tokenId: row.id,
        patientId: patient.id,
        otherPatientId: raced?.id ?? "",
      };
    }

    try {
      await prisma.auditLog.create({
        data: {
          clinicId: input.clinicId,
          action: "patient.telegram.invite_consumed",
          entityType: "Patient",
          entityId: patient.id,
          meta: {
            tokenId: row.id,
            telegramId: input.telegramId,
            telegramUsername: input.telegramUsername ?? null,
            retiredPatientId,
          },
        },
      });
    } catch (auditErr) {
      console.warn("[telegram-invite] consume audit failed", auditErr);
    }

    return {
      kind: "linked",
      patientId: patient.id,
      tokenId: row.id,
      retiredPatientId,
    };
  });
}

/**
 * Mint — or reuse within 24h — the patient's personal deep-link token.
 *
 * Extracted from the invite API route so the printed conclusion can carry the
 * same link as a QR: paper is the one artefact every patient walks out
 * holding, which makes it the highest-leverage place to grow bot adoption.
 * Reuse matters doubly here — every print/reprint of a conclusion calls this,
 * and each call must NOT mint a fresh row.
 *
 * Returns null when the clinic has no bot username (a t.me URL would be
 * meaningless) or the patient is already linked (nothing to invite).
 */
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h

export async function mintOrReuseInviteUrl(args: {
  patientId: string;
  createdByUserId: string | null;
}): Promise<{ url: string; token: string } | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: { id: true, clinicId: true, telegramId: true, deletedAt: true },
  });
  if (!patient || patient.deletedAt || patient.telegramId) return null;

  const clinic = await prisma.clinic.findUnique({
    where: { id: patient.clinicId },
    select: { tgBotUsername: true },
  });
  if (!clinic?.tgBotUsername) return null;

  const now = new Date();
  const existing = await prisma.telegramInviteToken.findFirst({
    where: {
      patientId: patient.id,
      consumedAt: null,
      expiresAt: { gt: now },
      createdAt: { gte: new Date(now.getTime() - REUSE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { token: true },
  });

  const token =
    existing?.token ??
    (
      await prisma.telegramInviteToken.create({
        data: {
          patientId: patient.id,
          clinicId: patient.clinicId,
          token: randomBytes(12).toString("base64url"),
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          createdByUserId: args.createdByUserId,
        },
        select: { token: true },
      })
    ).token;

  return { url: `https://t.me/${clinic.tgBotUsername}?start=${token}`, token };
}
