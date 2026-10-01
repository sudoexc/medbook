/**
 * Phase 16 Wave 1 — DELETE /api/miniapp/family/[linkedPatientId]
 *
 * Unlinks a relative from the authenticated owner. Drops the
 * `PatientFamily` row only — the linked Patient row stays intact (and so
 * do their appointments / cases / payments). The relative is simply no
 * longer accessible from the owner's TG family switcher.
 *
 * Phase M2 — publishes `patient.familyUnlinked` via the outbox; the
 * pumper materialises the audit row from the envelope (auditable=true).
 *
 * Refused (409 `has_upcoming_bookings`) while the relative still holds Mini
 * App bookings ahead (audit MA-14). The account's booking cap counts the
 * owner and his linked relatives; an unlink kept her bookings but dropped
 * them out of that count, so add, book, unlink, repeat took slot after slot
 * from one Telegram account.
 */
import { prisma } from "@/lib/prisma";
import { conflict, notFound, ok } from "@/server/http";
import { runQueueTx } from "@/server/appointments/queue-order";
import { hasMiniAppBookingsAhead } from "@/server/miniapp/booking-limits";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

function linkedPatientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const DELETE = createMiniAppHandler({}, async ({ request, ctx }) => {
  const linkedPatientId = linkedPatientIdFromUrl(request);
  const link = await prisma.patientFamily.findFirst({
    where: {
      clinicId: ctx.clinicId,
      ownerPatientId: ctx.patientId,
      linkedPatientId,
    },
    select: { id: true, relationship: true, linkedPatientId: true },
  });
  if (!link) return notFound();

  // Serializable (with retries), like the booking that counts this link: a
  // booking for her racing the unlink makes one of the two retry and see the
  // other (the unlink then refuses, or the booking's guard finds her no
  // longer linked), so she cannot end up unlinked with a fresh booking.
  const unlinked = await runQueueTx(async (tx) => {
    if (
      await hasMiniAppBookingsAhead(tx, {
        clinicId: ctx.clinicId,
        patientId: link.linkedPatientId,
        now: new Date(),
      })
    ) {
      return false;
    }
    await tx.patientFamily.delete({ where: { id: link.id } });

    const envelope: EventEnvelopeInput = {
      correlationId: newCorrelationId(),
      actor: {
        role: "PATIENT",
        userId: null,
        patientId: ctx.patientId,
        onBehalfOfPatientId: null,
        label: `patient:${ctx.patientId}`,
      },
      surface: "MINIAPP",
      tenantScope: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
      },
      type: "patient.familyUnlinked",
      payload: {
        ownerPatientId: ctx.patientId,
        linkedPatientId: link.linkedPatientId,
        relationship: link.relationship,
      },
    };
    await publishViaOutbox(tx, envelope);
    return true;
  });
  if (!unlinked) return conflict("has_upcoming_bookings");

  return ok({ ok: true });
});
