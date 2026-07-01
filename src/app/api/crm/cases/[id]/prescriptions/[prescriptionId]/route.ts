/**
 * PATCH/DELETE /api/crm/cases/[id]/prescriptions/[prescriptionId]
 *
 * - PATCH accepts a partial update; the schedule is replaced atomically (we
 *   don't merge — the editor re-submits the whole `{times,days,startsAt}`).
 * - DELETE is a hard delete. Cascade unwinds `MedicationReminderSend` rows
 *   (referential `onDelete: Cascade`).
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err, notFound, diff } from "@/server/http";
import {
  hydratePrescriptionForRead,
  serializePrescriptionForWrite,
} from "@/server/prescription/cipher-fields";
import { UpdatePrescriptionSchema } from "@/server/schemas/prescription";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { ActorRole, Surface } from "@/server/realtime/envelope";

function idsFromUrl(request: Request): {
  caseId: string;
  prescriptionId: string;
} {
  // /api/crm/cases/[id]/prescriptions/[prescriptionId]
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return {
    caseId: parts[parts.length - 3] ?? "",
    prescriptionId: parts[parts.length - 1] ?? "",
  };
}

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR"],
    bodySchema: UpdatePrescriptionSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const { caseId, prescriptionId } = idsFromUrl(request);

    const before = await prisma.prescription.findUnique({
      where: { id: prescriptionId },
      select: {
        id: true,
        caseId: true,
        patientId: true,
        drugName: true,
        dosage: true,
        schedule: true,
        notes: true,
        status: true,
        remindersEnabled: true,
      },
    });
    if (!before || before.caseId !== caseId) return notFound();

    const dataRaw: Record<string, unknown> = {};
    if (body.drugName !== undefined) dataRaw.drugName = body.drugName;
    if (body.dosage !== undefined) dataRaw.dosage = body.dosage;
    if (body.notes !== undefined) dataRaw.notes = body.notes;
    if (body.remindersEnabled !== undefined) {
      dataRaw.remindersEnabled = body.remindersEnabled;
    }
    if (body.status !== undefined) dataRaw.status = body.status;
    if (body.schedule !== undefined) {
      // Carry forward an existing startsAt if the editor didn't change it.
      const oldStart =
        body.schedule.startsAt ??
        ((before.schedule as { startsAt?: string } | null)?.startsAt ?? null);
      dataRaw.schedule = {
        times: body.schedule.times,
        days: body.schedule.days ?? null,
        startsAt: oldStart ?? new Date().toISOString(),
      };
    }
    const data = serializePrescriptionForWrite(
      dataRaw as { notes?: string | null | undefined } & Record<string, unknown>,
    );

    const actorRole: ActorRole = ctx.role === "DOCTOR" ? "DOCTOR" : "ADMIN";
    const surface: Surface = ctx.role === "DOCTOR" ? "DOCTOR_CABINET" : "CRM";

    const after = await prisma.$transaction(async (tx) => {
      const row = await tx.prescription.update({
        where: { id: prescriptionId },
        data: data as never,
        include: {
          doctor: { select: { id: true, nameRu: true, nameUz: true } },
        },
      });
      // Cross-surface sync — refresh the patient's Mini App /medications live.
      await publishViaOutbox(tx, {
        correlationId: newCorrelationId(),
        actor: {
          role: actorRole,
          userId: ctx.userId,
          patientId: null,
          onBehalfOfPatientId: null,
          label: `user:${ctx.userId}`,
        },
        surface,
        tenantScope: { clinicId: ctx.clinicId, patientId: before.patientId },
        type: "prescription.updated",
        payload: {
          prescriptionId,
          patientId: before.patientId,
          status: row.status,
        },
      });
      return row;
    });

    const beforeHydrated = hydratePrescriptionForRead(
      before as unknown as { notes?: string | null },
    );
    const afterHydrated = hydratePrescriptionForRead(after);
    const d = diff(
      { ...(before as unknown as Record<string, unknown>), ...beforeHydrated },
      { ...(after as unknown as Record<string, unknown>), ...afterHydrated },
    );
    await audit(request, {
      action: AUDIT_ACTION.PRESCRIPTION_UPDATED,
      entityType: "Prescription",
      entityId: prescriptionId,
      meta: { caseId, ...d },
    });

    return ok(afterHydrated);
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const { caseId, prescriptionId } = idsFromUrl(request);

    const before = await prisma.prescription.findUnique({
      where: { id: prescriptionId },
      select: {
        id: true,
        caseId: true,
        patientId: true,
        drugName: true,
        dosage: true,
        schedule: true,
        status: true,
      },
    });
    if (!before || before.caseId !== caseId) return notFound();

    const actorRole: ActorRole = ctx.role === "DOCTOR" ? "DOCTOR" : "ADMIN";
    const surface: Surface = ctx.role === "DOCTOR" ? "DOCTOR_CABINET" : "CRM";

    await prisma.$transaction(async (tx) => {
      await tx.prescription.delete({ where: { id: prescriptionId } });
      // Cross-surface sync — drop the drug from the patient's schedule live.
      await publishViaOutbox(tx, {
        correlationId: newCorrelationId(),
        actor: {
          role: actorRole,
          userId: ctx.userId,
          patientId: null,
          onBehalfOfPatientId: null,
          label: `user:${ctx.userId}`,
        },
        surface,
        tenantScope: { clinicId: ctx.clinicId, patientId: before.patientId },
        type: "prescription.updated",
        payload: {
          prescriptionId,
          patientId: before.patientId,
          status: before.status,
          deleted: true,
        },
      });
    });

    await audit(request, {
      action: AUDIT_ACTION.PRESCRIPTION_DELETED,
      entityType: "Prescription",
      entityId: prescriptionId,
      meta: {
        caseId,
        patientId: before.patientId,
        drugName: before.drugName,
        dosage: before.dosage,
        status: before.status,
      },
    });

    return ok({ id: prescriptionId, deleted: true });
  },
);
