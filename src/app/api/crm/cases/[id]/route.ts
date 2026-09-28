/**
 * /api/crm/cases/[id] — get one, patch.
 *
 * GET returns the full case + appointment timeline (sorted asc) + lightweight
 * patient / primaryDoctor + computed `visitCount` (visits that happened or
 * are ahead: cancelled ones and no-shows take no number, audit PT-16) and
 * `finance` (the patient card's money formula over the case's visits).
 * Front desk and call center get the case without its clinical side
 * (diagnosis, SOAP draft, prescriptions; audit PT-11).
 *
 * PATCH accepts the editable fields only. When `status` transitions
 * OPEN → terminal (RESOLVED | ABANDONED | TRANSFERRED), `closedAt` is
 * stamped server-side and the case's running prescriptions end with it
 * (audit PT-10); reverse transition (back to OPEN) clears `closedAt`.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import type { TenantContext } from "@/lib/tenant-context";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";
import {
  hydrateMedicalCaseForRead,
  serializeMedicalCaseForWrite,
} from "@/server/medical-case/cipher-fields";
import { hydratePrescriptionListForRead } from "@/server/prescription/cipher-fields";
import { UpdateMedicalCaseSchema } from "@/server/schemas/medical-case";
import { recordPatientView } from "@/server/audit/patient-view";
import { clientIpForAudit } from "@/lib/client-ip";
import {
  CASE_NAME_ONLY_FIELDS,
  redactedDiff,
} from "@/server/audit/patient-audit-meta";
import {
  canReadCaseClinical,
  canWriteCaseClinical,
  clinicalFieldsIn,
  withoutCaseClinical,
} from "@/server/medical-case/clinical-access";
import { endCasePrescriptions } from "@/server/medical-case/close-effects";
import { RUNNING_PRESCRIPTION_STATUSES } from "@/lib/cases/case-close";
import { loadCaseFinance } from "@/server/patient/finance";
import { caseVisitStats } from "@/lib/cases/case-visits";
import type { ActorRole, Surface } from "@/server/realtime/envelope";

function idFromUrl(request: Request): string {
  // /.../cases/[id]
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const DETAIL_INCLUDE = {
  primaryDoctor: {
    select: { id: true, nameRu: true, nameUz: true, color: true, photoUrl: true },
  },
  patient: {
    select: { id: true, fullName: true, phone: true },
  },
  appointments: {
    // Timeline order, with stable ties: the visit numbers are counted along
    // it (`caseVisitOrdinals`).
    orderBy: [
      { date: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ] as Prisma.AppointmentOrderByWithRelationInput[],
    select: {
      id: true,
      date: true,
      time: true,
      durationMin: true,
      status: true,
      doctorId: true,
      priceFinal: true,
      doctor: {
        select: { id: true, nameRu: true, nameUz: true, color: true, photoUrl: true },
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
        ip: clientIpForAudit(request),
        userAgent: request.headers.get("user-agent"),
      });
    }

    // visitCount: the visits that take a number (a cancelled one or a
    // no-show never happened, audit PT-16).
    const visitCount = caseVisitStats(row.appointments).numberedVisits;
    const finance = await loadCaseFinance(row.clinicId, row.id);
    // How many courses closing the case would end: the close dialog says
    // so up front, for every role that may close it.
    const runningPrescriptions = row.prescriptions.filter((p) =>
      (RUNNING_PRESCRIPTION_STATUSES as readonly string[]).includes(p.status),
    ).length;
    const body = {
      ...hydrateMedicalCaseForRead(row),
      prescriptions: hydratePrescriptionListForRead(row.prescriptions),
      visitCount,
      finance,
      runningPrescriptions,
    };
    return ok(canReadCaseClinical(ctx) ? body : withoutCaseClinical(body));
  }
);

const TERMINAL_STATUSES = new Set(["RESOLVED", "ABANDONED", "TRANSFERRED"]);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: UpdateMedicalCaseSchema,
  },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    // The diagnosis and the SOAP draft are the doctor's (audit PT-11): the
    // front desk renames, reassigns and closes cases, it does not rewrite
    // what the doctor concluded.
    const clinicalFields = clinicalFieldsIn(body as Record<string, unknown>);
    if (clinicalFields.length > 0 && !canWriteCaseClinical(ctx)) {
      return err("Forbidden", 403, {
        reason: "clinical_fields_forbidden",
        fields: clinicalFields,
      });
    }
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
    let closing = false;
    if (body.status !== undefined && body.status !== before.status) {
      const wasOpen = before.status === "OPEN";
      const willBeTerminal = TERMINAL_STATUSES.has(body.status);
      const willBeOpen = body.status === "OPEN";
      if (wasOpen && willBeTerminal) {
        data.closedAt = new Date();
        closing = true;
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

    const { after, endedPrescriptions } = await prisma.$transaction(
      async (tx) => {
        const row = await tx.medicalCase.update({
          where: { id },
          data: data as never,
          include: {
            primaryDoctor: {
              select: { id: true, nameRu: true, nameUz: true, color: true, photoUrl: true },
            },
            patient: {
              select: { id: true, fullName: true, phone: true },
            },
            _count: { select: { appointments: true } },
          },
        });
        // Closing the case ends its courses in the same write, so no
        // reminder tick can fall between the two (audit PT-10).
        const ended = closing
          ? await endCasePrescriptions(tx, {
              caseId: id,
              clinicId: before.clinicId,
              patientId: before.patientId,
              caseStatus: row.status,
              actor: closeActorOf(ctx),
            })
          : [];
        return { after: row, endedPrescriptions: ended };
      },
    );

    const beforeHydrated = hydrateMedicalCaseForRead(before);
    const afterHydrated = hydrateMedicalCaseForRead(after);
    await audit(request, {
      action: "medical_case.update",
      entityType: "MedicalCase",
      entityId: id,
      // Columns only, the SOAP draft by name (audit SEC-09): the `patient`
      // include used to put the name and phone into every case edit.
      meta: {
        ...redactedDiff(
          beforeHydrated as unknown as Record<string, unknown>,
          afterHydrated as unknown as Record<string, unknown>,
          CASE_NAME_ONLY_FIELDS,
        ),
        ...(endedPrescriptions.length > 0 ? { endedPrescriptions } : {}),
      },
    });

    return ok(
      canReadCaseClinical(ctx) ? afterHydrated : withoutCaseClinical(afterHydrated),
    );
  }
);

/** Who closed the case, for the Mini App refresh events. */
function closeActorOf(ctx: TenantContext): {
  role: ActorRole;
  userId: string | null;
  surface: Surface;
} {
  if (ctx.kind === "TENANT") {
    const role: ActorRole =
      ctx.role === "DOCTOR"
        ? "DOCTOR"
        : ctx.role === "RECEPTIONIST"
          ? "RECEPTIONIST"
          : "ADMIN";
    return {
      role,
      userId: ctx.userId,
      surface: ctx.role === "DOCTOR" ? "DOCTOR_CABINET" : "CRM",
    };
  }
  if (ctx.kind === "SUPER_ADMIN") {
    return { role: "SUPER_ADMIN", userId: ctx.userId, surface: "CRM" };
  }
  return { role: "SYSTEM", userId: null, surface: "CRM" };
}
