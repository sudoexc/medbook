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
