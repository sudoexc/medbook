/**
 * Tell the patient's Mini App that one of his documents changed or is gone
 * (audit CD-09): it held a deleted document, a dead link, until the patient
 * reloaded. Shared by the edit, delete and void routes, inside their
 * transaction so the event leaves only with the change.
 */
import {
  newCorrelationId,
  publishViaOutbox,
  type OutboxTx,
} from "@/server/realtime/outbox";
import type { ActorRole, Surface } from "@/server/realtime/envelope";
import { isClinicAdmin } from "@/lib/permissions/clinic-admin";
import type { TenantContext } from "@/lib/tenant-context";

export async function publishDocumentChange(
  tx: OutboxTx,
  ctx: TenantContext,
  type: "document.updated" | "document.deleted",
  doc: { id: string; clinicId: string; patientId: string; type: string },
): Promise<void> {
  const userId = ctx.kind === "TENANT" ? ctx.userId : null;
  const role = ctx.kind === "TENANT" ? ctx.role : null;
  // The owner inside a clinic acts as its admin (owner request 09.10.2026).
  const actorRole: ActorRole =
    role === "DOCTOR" ? "DOCTOR" : isClinicAdmin(role) ? "ADMIN" : "SYSTEM";
  const surface: Surface = role === "DOCTOR" ? "DOCTOR_CABINET" : "CRM";
  await publishViaOutbox(tx, {
    correlationId: newCorrelationId(),
    actor: {
      role: actorRole,
      userId,
      patientId: null,
      onBehalfOfPatientId: null,
      label: role && userId ? `${role.toLowerCase()}:${userId}` : "system",
    },
    surface,
    tenantScope: { clinicId: doc.clinicId, patientId: doc.patientId },
    type,
    payload: {
      documentId: doc.id,
      patientId: doc.patientId,
      documentType: doc.type,
    },
  });
}
