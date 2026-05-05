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
import { UpdateMedicalCaseSchema } from "@/server/schemas/medical-case";

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
} as const;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.medicalCase.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!row) return notFound();

    // visitCount: explicit field so the frontend can label "N-th visit"
    // without re-counting the appointments array on every render.
    const visitCount = row.appointments.length;
    return ok({ ...row, visitCount });
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

    const data: Record<string, unknown> = { ...body };

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

    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    await audit(request, {
      action: "medical_case.update",
      entityType: "MedicalCase",
      entityId: id,
      meta: d,
    });

    return ok(after);
  }
);
