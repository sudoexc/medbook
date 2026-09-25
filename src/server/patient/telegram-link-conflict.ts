/**
 * «This Telegram account proved it is the patient of card B, but it is
 * already bound to card A, and A holds real history» (audit MA-04, PH-01).
 *
 * The bot never merges two medical records on its own: a merge moves visits,
 * conclusions and prescriptions and must be a human decision. It leaves both
 * cards as they are and hands reception a TELEGRAM_LINK_CONFLICT task that
 * opens the clinic's card, plus an audit row with both ids.
 *
 * The task has no `expiresAt` on purpose: the conflict stays real until a
 * person merges the cards or dismisses it. Nothing re-upserts it, and the
 * engine's 48h `updatedAt` sweep only covers detector types
 * (`DETECTOR_ACTION_TYPES`), so it cannot quietly expire over a weekend.
 *
 * Best-effort: a failure here is logged, never thrown, so the bot still
 * answers the patient and the invite / contact flow still completes.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { upsertAction } from "@/server/actions/repository";
import { publishEventSafe } from "@/server/realtime/publish";
import type { TelegramLinkConflictPayload } from "@/lib/actions/types";

export async function raiseTelegramLinkConflict(params: {
  clinicId: string;
  telegramId: string;
  telegramCard: { id: string; fullName: string };
  clinicCard: { id: string; fullName: string };
  via: "invite" | "contact" | "contactName";
}): Promise<void> {
  const payload: TelegramLinkConflictPayload = {
    type: "TELEGRAM_LINK_CONFLICT",
    telegramCardId: params.telegramCard.id,
    telegramCardName: params.telegramCard.fullName,
    clinicCardId: params.clinicCard.id,
    clinicCardName: params.clinicCard.fullName,
    via: params.via,
  };
  try {
    await runWithTenant({ kind: "SYSTEM" }, async () => {
      await prisma.auditLog.create({
        data: {
          clinicId: params.clinicId,
          action: "patient.telegram.link_conflict",
          entityType: "Patient",
          entityId: params.clinicCard.id,
          meta: {
            telegramId: params.telegramId,
            telegramCardId: params.telegramCard.id,
            via: params.via,
          },
        },
      });
      const result = await upsertAction(prisma, params.clinicId, payload, {
        deeplinkPath: `/crm/patients/${params.clinicCard.id}`,
      });
      if (result.created) {
        publishEventSafe(params.clinicId, {
          type: "action.created",
          payload: {
            id: result.id,
            type: payload.type,
            severity: result.severity,
          },
        });
      }
    });
  } catch (e) {
    console.error("[patient.telegram-link-conflict]", e);
  }
}
