/**
 * /api/crm/cases/[id] — get one, patch.
 *
 * GET returns the full case + appointment timeline (sorted asc) + lightweight
 * patient / primaryDoctor + computed `visitCount`.
 *
 * PATCH accepts the editable fields only. When `status` transitions
 * OPEN → terminal (RESOLVED | ABANDONED | TRANSFERRED), `closedAt` is
 * stamped server-side; reverse transition (back to OPEN) clears it.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import {
  hydrateMedicalCaseForRead,
  serializeMedicalCaseForWrite,
} from "@/server/medical-case/cipher-fields";
import { hydratePrescriptionListForRead } from "@/server/prescription/cipher-fields";
import { UpdateMedicalCaseSchema } from "@/server/schemas/medical-case";
import { recordPatientView } from "@/server/audit/patient-view";

function idFromUrl(request: Request): string {
  // /.../cases/[id]
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const DETAIL_INCLUDE = {
  primaryDoctor: {
    select: { id: true, nameRu: true, nameUz: true, color: true },
  },
  patient: {
    select: { id: true, fullName: true, phone: true },
  },
  appointments: {
    orderBy: { date: "asc" as const },
    select: {
      id: true,
      date: true,
      time: true,
      durationMin: true,
      status: true,
      doctorId: true,
      priceFinal: true,
      doctor: {
        select: { id: true, nameRu: true, nameUz: true, color: true },
      },
      primaryService: {
        select: { id: true, nameRu: true, nameUz: true },
      },
    },
  },
  // Phase 16 Wave 3 — Prescriptions live on the case detail. Folded into the
  // existing `findUnique` so the case-detail-client doesn't need a second
  // round-trip to render the PrescriptionsCard.
  prescriptions: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      drugName: true,
      dosage: true,
      schedule: true,
      notes: true,
      status: true,
      remindersEnabled: true,
      doctorId: true,
      createdAt: true,
      updatedAt: true,
      doctor: {
        select: { id: true, nameRu: true, nameUz: true },
      },
    },
  },
} as const;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const row = await prisma.medicalCase.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!row) return notFound();

    // Phase 17 Wave 1 — case detail surfaces the patient's PHI; record an
    // audit row (5-minute throttle).
    if (ctx.kind === "TENANT") {
      void recordPatientView({
        prisma,
        clinicId: ctx.clinicId,
        viewerUserId: ctx.userId,
        viewerRole: ctx.role,
        patientId: row.patientId,
        context: "case.detail",
        contextRef: row.id,
        ip:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent"),
      });
    }

    // visitCount: explicit field so the frontend can label "N-th visit"
    // without re-counting the appointments array on every render.
    const visitCount = row.appointments.length;
    const hydrated = hydrateMedicalCaseForRead(row);
    const hydratedPrescriptions = hydratePrescriptionListForRead(
      row.prescriptions,
    );
    return ok({
      ...hydrated,
      prescriptions: hydratedPrescriptions,
      visitCount,
    });
  }
);

const TERMINAL_STATUSES = new Set(["RESOLVED", "ABANDONED", "TRANSFERRED"]);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: UpdateMedicalCaseSchema,
  },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.medicalCase.findUnique({ where: { id } });
    if (!before) return notFound();

    // Validate doctor ownership when reassigning. Tenant scope auto-applies.
    if (body.primaryDoctorId) {
      const doc = await prisma.doctor.findUnique({
        where: { id: body.primaryDoctorId },
        select: { id: true },
      });
      if (!doc) {
        return err("ValidationError", 400, { reason: "doctor_not_found" });
      }
    }

    const data: Record<string, unknown> = serializeMedicalCaseForWrite({
      ...body,
    });

    // Status transition side-effects on closedAt.
    if (body.status !== undefined && body.status !== before.status) {
      const wasOpen = before.status === "OPEN";
      const willBeTerminal = TERMINAL_STATUSES.has(body.status);
      const willBeOpen = body.status === "OPEN";
      if (wasOpen && willBeTerminal) {
        data.closedAt = new Date();
      } else if (!wasOpen && willBeOpen) {
        // Re-opened — clear closedAt and any previously stored reason. Caller
        // can still pass an explicit closedReason in the same PATCH; the
        // explicit value (in `data`) wins because we set it after.
        data.closedAt = null;
        if (body.closedReason === undefined) {
          data.closedReason = null;
        }
      }
    }

    const after = await prisma.medicalCase.update({
      where: { id },
      data: data as never,
      include: {
        primaryDoctor: {
          select: { id: true, nameRu: true, nameUz: true, color: true },
        },
        patient: {
          select: { id: true, fullName: true, phone: true },
        },
        _count: { select: { appointments: true } },
      },
    });

    const beforeHydrated = hydrateMedicalCaseForRead(
      before as unknown as { soapDraft?: string | null },
    );
    const afterHydrated = hydrateMedicalCaseForRead(after);
    const d = diff(
      { ...(before as unknown as Record<string, unknown>), ...beforeHydrated },
      { ...(after as unknown as Record<string, unknown>), ...afterHydrated },
    );
    await audit(request, {
      action: "medical_case.update",
      entityType: "MedicalCase",
      entityId: id,
      meta: d,
    });

    return ok(afterHydrated);
  }
);
