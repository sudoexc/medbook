/**
 * /api/crm/patients/[id] — get, patch, delete. See docs/TZ.md §6.5.
 *
 * Phase 17 Wave 1 — GET also records a PatientView audit row (5-minute
 * throttle) so PHI access is forensically reviewable from /crm/settings/audit.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
import { ok, notFound, diff } from "@/server/http";
import {
  hydratePatientForRead,
  serializePatientForWrite,
} from "@/server/patient/cipher-fields";
import { UpdatePatientSchema } from "@/server/schemas/patient";
import { recordPatientView } from "@/server/audit/patient-view";

function idFromUrl(request: Request): string {
  // App Router passes params via the route handler signature, but we're
  // using the wrapper — derive from URL to stay wrapper-friendly.
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  // /.../patients/[id]
  return segments[segments.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const row = await prisma.patient.findUnique({
      where: { id },
      include: {
        appointments: {
          orderBy: { date: "desc" },
          take: 10,
          include: {
            doctor: { select: { id: true, nameRu: true, nameUz: true } },
            primaryService: { select: { id: true, nameRu: true, nameUz: true } },
          },
        },
      },
    });
    if (!row) return notFound();
    // Phase 17 Wave 1 — log PHI access (5-min throttle).
    if (ctx.kind === "TENANT") {
      void recordPatientView({
        prisma,
        clinicId: ctx.clinicId,
        viewerUserId: ctx.userId,
        viewerRole: ctx.role,
        patientId: id,
        context: "patient.detail",
        ip:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent"),
      });
    }
    return ok(hydratePatientForRead(row));
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: UpdatePatientSchema,
  },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.patient.findUnique({ where: { id } });
    if (!before) return notFound();

    const data: Record<string, unknown> = serializePatientForWrite({ ...body });
    if (body.phone) {
      data.phoneNormalized = normalizePhone(body.phone);
    }

    const after = await prisma.patient.update({
      where: { id },
      data: data as never,
    });
    const beforeHydrated = hydratePatientForRead(
      before as unknown as { passport?: string | null; notes?: string | null },
    );
    const afterHydrated = hydratePatientForRead(after);
    const d = diff(
      { ...(before as unknown as Record<string, unknown>), ...beforeHydrated },
      { ...(after as unknown as Record<string, unknown>), ...afterHydrated },
    );
    await audit(request, {
      action: "patient.update",
      entityType: "Patient",
      entityId: id,
      meta: d,
    });
    return ok(afterHydrated);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.patient.findUnique({ where: { id } });
    if (!before) return notFound();
    await prisma.patient.delete({ where: { id } });
    await audit(request, {
      action: "patient.delete",
      entityType: "Patient",
      entityId: id,
      // Hydrate before snapshotting — the audit row should carry plaintext so
      // forensic reconstruction doesn't need the active key.
      meta: { before: hydratePatientForRead(before) },
    });
    return ok({ id, deleted: true });
  }
);
