/**
 * /api/crm/documents — list + create document record.
 * See docs/TZ.md §6.5.
 *
 * Actual file-upload persistence is out-of-scope for Phase 1; POST stores
 * the metadata + `fileUrl` that the UI already uploaded somewhere.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, parseQuery } from "@/server/http";
import {
  CreateDocumentSchema,
  QueryDocumentSchema,
} from "@/server/schemas/document";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryDocumentSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.patientId) where.patientId = q.patientId;
    if (q.appointmentId) where.appointmentId = q.appointmentId;
    if (q.type) where.type = q.type;
    if (q.q) where.title = { contains: q.q, mode: "insensitive" };
    if (q.doctorId) {
      where.OR = [
        { appointment: { doctorId: q.doctorId } },
        { patient: { appointments: { some: { doctorId: q.doctorId } } } },
      ];
    }
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lte = new Date(q.to);
      where.createdAt = range;
    }
    if (q.pendingSignature === true) {
      // Stub: treat CONSENT/CONTRACT docs without `fileUrl` meta token as pending.
      where.type = { in: ["CONSENT", "CONTRACT"] };
    }

    // DOCTOR sees only documents for their patients/appointments.
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doc = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (doc) {
        where.OR = [
          { appointment: { doctorId: doc.id } },
          { patient: { appointments: { some: { doctorId: doc.id } } } },
        ];
      }
    }

    const take = q.limit + 1;
    const rows = await prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        patient: { select: { id: true, fullName: true } },
        uploadedBy: { select: { id: true, name: true } },
        appointment: {
          select: {
            id: true,
            doctor: { select: { id: true, nameRu: true, nameUz: true } },
          },
        },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({ rows, nextCursor });
  }
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"],
    bodySchema: CreateDocumentSchema,
  },
  async ({ request, body, ctx }) => {
    const uploadedById = ctx.kind === "TENANT" ? ctx.userId : null;
    const created = await prisma.document.create({
      data: {
        patientId: body.patientId,
        appointmentId: body.appointmentId ?? null,
        type: body.type,
        title: body.title,
        fileUrl: body.fileUrl,
        mimeType: body.mimeType ?? null,
        sizeBytes: body.sizeBytes ?? null,
        uploadedById,
      } as never,
    });
    await audit(request, {
      action: "document.create",
      entityType: "Document",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);
