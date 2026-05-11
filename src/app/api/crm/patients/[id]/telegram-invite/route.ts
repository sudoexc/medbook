/**
 * /api/crm/patients/[id]/telegram-invite — mint a Telegram deep link.
 *
 * Body: none (POST). The endpoint is idempotent within a 24h reuse
 * window: a follow-up POST returns the same active token instead of
 * minting a new row, so refreshing the dialog doesn't churn the table.
 *
 * Response: `{ url, token, expiresAt, isFreshlyMinted }` plus the
 * patient's clinic-side `tgBotUsername` (callers display it next to the
 * link to reassure the staff member they're sharing the real bot).
 *
 * 412 + `bot_not_configured` is returned when the clinic has no
 * `tgBotUsername` set — without it the t.me URL is meaningless.
 *
 * 409 + `already_linked` is returned when the patient already has a
 * `telegramId`, so a fresh invite would just confuse the receptionist.
 * The response carries the linked username/id so the dialog can fall
 * back to a "Already linked as …" hint.
 */
import { randomBytes } from "node:crypto";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { conflict, err, notFound, ok } from "@/server/http";

const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/telegram-invite
  return parts[parts.length - 2] ?? "";
}

function mintToken(): string {
  // 12 random bytes → 16 chars base64url. Telegram /start payload accepts
  // up to 64 chars, so we have plenty of headroom if we ever decide to
  // prefix with a clinic shard.
  return randomBytes(12).toString("base64url");
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    if (!id) return err("InvalidPatientId", 400);

    const patient = await prisma.patient.findUnique({
      where: { id },
      select: {
        id: true,
        clinicId: true,
        fullName: true,
        phone: true,
        telegramId: true,
        telegramUsername: true,
        deletedAt: true,
      },
    });
    if (!patient || patient.deletedAt) return notFound();

    if (patient.telegramId) {
      return conflict("already_linked", {
        telegramId: patient.telegramId,
        telegramUsername: patient.telegramUsername,
      });
    }

    const clinic = await prisma.clinic.findUnique({
      where: { id: patient.clinicId },
      select: { tgBotUsername: true },
    });
    if (!clinic?.tgBotUsername) {
      return err("bot_not_configured", 412);
    }

    const now = new Date();
    const reuseFrom = new Date(now.getTime() - REUSE_WINDOW_MS);

    // Look for an active (unconsumed, not expired, minted recently) token
    // and reuse it. Indexed lookup via patientId; the unique constraint
    // is on `token` so a partial scan over the patient's own rows is
    // cheap (a typical clinic mints a handful per patient at most).
    const existing = await prisma.telegramInviteToken.findFirst({
      where: {
        patientId: patient.id,
        consumedAt: null,
        expiresAt: { gt: now },
        createdAt: { gte: reuseFrom },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, token: true, expiresAt: true },
    });

    const row =
      existing ??
      (await prisma.telegramInviteToken.create({
        data: {
          clinicId: patient.clinicId,
          patientId: patient.id,
          token: mintToken(),
          createdByUserId: ctx.kind === "TENANT" ? ctx.userId : null,
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        },
        select: { id: true, token: true, expiresAt: true },
      }));

    const url = `https://t.me/${clinic.tgBotUsername}?start=${row.token}`;

    try {
      await prisma.auditLog.create({
        data: {
          clinicId: patient.clinicId,
          actorId: ctx.kind === "TENANT" ? ctx.userId : null,
          actorRole: ctx.kind === "TENANT" ? ctx.role : null,
          action: "patient.telegram.invite_minted",
          entityType: "TelegramInviteToken",
          entityId: row.id,
          meta: {
            patientId: patient.id,
            reused: Boolean(existing),
            botUsername: clinic.tgBotUsername,
          },
        },
      });
    } catch (auditErr) {
      console.warn("[telegram-invite] audit failed", auditErr);
    }

    return ok({
      url,
      token: row.token,
      expiresAt: row.expiresAt.toISOString(),
      botUsername: clinic.tgBotUsername,
      isFreshlyMinted: !existing,
      patient: {
        id: patient.id,
        fullName: patient.fullName,
        phone: patient.phone,
      },
    });
  },
);
