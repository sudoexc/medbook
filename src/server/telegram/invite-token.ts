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

export type InviteConsumeResult =
  | { kind: "linked"; patientId: string; tokenId: string }
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
      select: { id: true, telegramId: true },
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

    await prisma.$transaction([
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
          },
        },
      });
    } catch (auditErr) {
      console.warn("[telegram-invite] consume audit failed", auditErr);
    }

    return { kind: "linked", patientId: patient.id, tokenId: row.id };
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
