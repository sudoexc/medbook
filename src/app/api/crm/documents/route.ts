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
import { normalizePhone } from "@/lib/phone";
import {
  CreateDocumentSchema,
  QueryDocumentSchema,
} from "@/server/schemas/document";

/**
 * Per-patient sequence number — `#1` is the patient's oldest document,
 * `#N` the newest. Stable across pagination/filtering because it depends
 * only on (patientId, createdAt, id) which never change post-create.
 * Computed via a correlated count rather than a window function so we only
 * pay for the row ids actually being returned.
 */
async function attachSeq<T extends { id: string; patientId: string; createdAt: Date }>(
  rows: T[],
): Promise<Array<T & { seq: number }>> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const seqRows = await prisma.$queryRawUnsafe<Array<{ id: string; seq: bigint }>>(
    `SELECT d.id,
            (SELECT COUNT(*)
               FROM "Document" d2
              WHERE d2."patientId" = d."patientId"
                AND (d2."createdAt" < d."createdAt"
                     OR (d2."createdAt" = d."createdAt" AND d2."id" <= d."id")))::bigint AS seq
       FROM "Document" d
      WHERE d.id = ANY($1::text[])`,
    ids,
  );
  const map = new Map(seqRows.map((r) => [r.id, Number(r.seq)] as const));
  return rows.map((r) => ({ ...r, seq: map.get(r.id) ?? 0 }));
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryDocumentSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    const andClauses: Array<Record<string, unknown>> = [];
    if (q.patientId) where.patientId = q.patientId;
    if (q.appointmentId) where.appointmentId = q.appointmentId;
    if (q.type) where.type = q.type;
    if (q.q) {
      const term = q.q.trim();
      const phoneDigits = term.replace(/\D/g, "");
      const phoneNorm = normalizePhone(term);
      const or: Array<Record<string, unknown>> = [
        { title: { contains: term, mode: "insensitive" } },
        { patient: { fullName: { contains: term, mode: "insensitive" } } },
        { patient: { phone: { contains: term } } },
      ];
      if (phoneDigits.length >= 3) {
        or.push({ patient: { phoneNormalized: { contains: phoneDigits } } });
        if (phoneNorm) {
          or.push({ patient: { phoneNormalized: { contains: phoneNorm } } });
        }
      }
      andClauses.push({ OR: or });
    }
    if (q.doctorId) {
      andClauses.push({
        OR: [
          { appointment: { doctorId: q.doctorId } },
          { patient: { appointments: { some: { doctorId: q.doctorId } } } },
        ],
      });
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
        andClauses.push({
          OR: [
            { appointment: { doctorId: doc.id } },
            { patient: { appointments: { some: { doctorId: doc.id } } } },
          ],
        });
      }
    }
    if (andClauses.length > 0) where.AND = andClauses;

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
    const withSeq = await attachSeq(rows);
    return ok({ rows: withSeq, nextCursor });
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
