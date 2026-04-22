/**
 * /api/crm/patients/[id] — get, patch, delete. See docs/TZ.md §6.5.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
import { ok, notFound, diff } from "@/server/http";
import { UpdatePatientSchema } from "@/server/schemas/patient";

function idFromUrl(request: Request): string {
  // App Router passes params via the route handler signature, but we're
  // using the wrapper — derive from URL to stay wrapper-friendly.
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  // /.../patients/[id]
  return segments[segments.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
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
    return ok(row);
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

    const data: Record<string, unknown> = { ...body };
    if (body.phone) {
      data.phoneNormalized = normalizePhone(body.phone);
    }

    const after = await prisma.patient.update({
      where: { id },
      data: data as never,
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "patient.update",
      entityType: "Patient",
      entityId: id,
      meta: d,
    });
    return ok(after);
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
      meta: { before },
    });
    return ok({ id, deleted: true });
  }
);
