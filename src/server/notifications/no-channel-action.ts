/**
 * Wave 4 of `docs/TZ-sms-removal.md` — PATIENT_NO_CHANNEL compensator.
 *
 * After the SMS kill-switch (Wave 1), `resolveChannels()` returns `[]` for
 * any TG-less patient whose template channel is the legacy "SMS" literal,
 * and `pickRecipient()` returns null for TG-less patients across the board.
 * Without this helper the materializer would silently drop the reminder —
 * the patient never hears from us.
 *
 * This module surfaces every such skip as a PATIENT_NO_CHANNEL Action in
 * `/crm/action-center`, dedupe'd per `(patientId, triggerKey, UTC-day)` so
 * a busy patient with several skipped triggers in one day still produces
 * one row per trigger and the dashboard isn't drowned.
 *
 * The Action also publishes an `action.created` realtime event so any open
 * Action Center tab refreshes without a manual reload.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { publishEventSafe } from "@/server/realtime/publish";
import { upsertAction } from "@/server/actions/repository";
import type { PatientNoChannelPayload } from "@/lib/actions/types";

/** YYYY-MM-DD in UTC. Stable per-day bucket for the 24h dedupe window. */
function utcBucket(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Record a single missed-channel signal.
 *
 * Idempotent per `(clinicId, patientId, triggerKey, UTC-day)`. Multiple
 * calls within the same day for the same trigger collapse onto the same
 * Action row via the dedupeKey contract in `dedupeKeyFor`. The next UTC
 * day rolls the bucket and reopens a fresh row.
 *
 * Errors are swallowed — the materializer is best-effort and the original
 * notification path already silently skipped; we never want a bug in the
 * Action insert to take down reminder scheduling.
 */
export async function recordPatientNoChannel(params: {
  clinicId: string;
  patientId: string;
  patientName: string;
  triggerKey: string;
  appointmentId?: string | null;
  appointmentAt?: Date | null;
  now?: Date;
  /**
   * Optional deeplink override. Defaults to `/crm/patients/<id>` so the
   * receptionist lands on the patient card (phone, history, conversation
   * tab) instead of the generic Call Center queue. The card is the
   * single best surface for "I need to call this person right now".
   */
  deeplinkPath?: string;
}): Promise<void> {
  const now = params.now ?? new Date();
  const payload: PatientNoChannelPayload = {
    type: "PATIENT_NO_CHANNEL",
    patientId: params.patientId,
    patientName: params.patientName,
    triggerKey: params.triggerKey,
    appointmentId: params.appointmentId ?? null,
    appointmentAt: params.appointmentAt
      ? params.appointmentAt.toISOString()
      : null,
    bucket: utcBucket(now),
  };
  const deeplinkPath =
    params.deeplinkPath ?? `/crm/patients/${params.patientId}`;

  try {
    const result = await runWithTenant({ kind: "SYSTEM" }, () =>
      upsertAction(prisma, params.clinicId, payload, { deeplinkPath }),
    );
    if (result.created) {
      publishEventSafe(params.clinicId, {
        type: "action.created",
        payload: {
          id: result.id,
          type: payload.type,
          severity: result.severity,
        },
      });
    } else if (result.payloadChanged || result.severityChanged) {
      publishEventSafe(params.clinicId, {
        type: "action.updated",
        payload: {
          id: result.id,
          type: payload.type,
          severity: result.severity,
        },
      });
    }
  } catch (err) {
    console.error("[notifications.no-channel-action]", err);
  }
}
