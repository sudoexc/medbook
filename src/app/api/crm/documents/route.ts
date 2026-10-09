/**
 * /api/crm/documents — list + create document record.
 * See docs/TZ.md §6.5.
 *
 * POST stores the metadata + the `fileUrl` of bytes the UI already sent to
 * `/api/crm/documents/upload`, together with that upload's receipt, or an
 * external `https:` link (audit CD-08, see `@/server/documents/file-ref`).
 * Rows created here are `source = STAFF` (CD-06). A signature captured on
 * the pad that signs a named unsigned consent (CD-05) is stamped `signedAt`
 * together with that consent; nothing else is ever created signed, so a
 * stray signature never becomes a legal record nobody can delete.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import { normalizePhone } from "@/lib/phone";
import { tashkentDayRange } from "@/lib/tashkent-time";
import {
  CreateDocumentSchema,
  QueryDocumentSchema,
} from "@/server/schemas/document";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import { isClinicAdmin } from "@/lib/permissions/clinic-admin";
import type { ActorRole, Surface } from "@/server/realtime/envelope";
import { withStaffFileUrl } from "@/lib/storage-ref";
import {
  checkDocumentFileUrl,
  storageKeyInUse,
} from "@/server/documents/file-ref";
import {
  SIGNABLE_DOCUMENT_TYPES,
  canMarkSigned,
} from "@/lib/document-guards";

/**
 * Per-patient sequence number — `#1` is the patient's oldest document,
 * `#N` the newest. Stable across pagination/filtering because it depends
 * only on (patientId, createdAt, id) which never change post-create.
 * Computed via a correlated count rather than a window function so we only
 * pay for the row ids actually being returned. The `clinicId` match is
 * redundant for correctness (a patient belongs to one clinic) but it is the
 * leading column of the only usable index, (clinicId, patientId, createdAt):
 * without it every returned row scanned the platform-wide table (audit CD-14).
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
              WHERE d2."clinicId" = d."clinicId"
                AND d2."patientId" = d."patientId"
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
    if (q.source) where.source = q.source;
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
    // `new Date("YYYY-MM-DD")` is UTC midnight (05:00 in Tashkent), so the
    // old `lte` dropped the whole last day (audit CM-16).
    const createdAt = tashkentDayRange(q.from, q.to);
    if (createdAt) where.createdAt = createdAt;
    if (q.pendingSignature === true) {
      // Consent/contract docs not yet marked signed (POST .../[id]/sign).
      // Pushed as an AND clause so it composes with an explicit `type` filter.
      // A patient's own upload is never the clinic's consent to sign (CD-06),
      // and a rendered document never waits for a signature either.
      andClauses.push({
        type: { in: [...SIGNABLE_DOCUMENT_TYPES] },
        signedAt: null,
        source: "STAFF",
        visitNoteId: null,
        referralId: null,
      });
    }

    // DOCTOR sees only documents for their patients/appointments. A DOCTOR
    // user with no Doctor profile yet has no patients: an empty list, as
    // visit-notes answers. Skipping the filter used to list every document
    // of the clinic (audit CD-15).
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doc = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doc) return ok({ rows: [], nextCursor: null });
      andClauses.push({
        OR: [
          { appointment: { doctorId: doc.id } },
          { patient: { appointments: { some: { doctorId: doc.id } } } },
        ],
      });
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
    // The stored URL points into the private bucket (AccessDenied in a
    // browser); every row leaves as our streaming proxy URL (CD-02).
    return ok({ rows: withSeq.map(withStaffFileUrl), nextCursor });
  }
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"],
    bodySchema: CreateDocumentSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const uploadedById = ctx.userId;
    const actorRole: ActorRole =
      ctx.role === "DOCTOR"
        ? "DOCTOR"
        : ctx.role === "RECEPTIONIST"
          ? "RECEPTIONIST"
          : isClinicAdmin(ctx.role) // the owner inside a clinic too (09.10.2026)
            ? "ADMIN"
            : "SYSTEM"; // NURSE has no ActorRole; real role rides in `label`
    const surface: Surface = ctx.role === "DOCTOR" ? "DOCTOR_CABINET" : "CRM";

    // CD-08: the file must be one this clinic just uploaded (receipt), and
    // not already another document's; otherwise an https link.
    const file = checkDocumentFileUrl({
      clinicId: ctx.clinicId,
      fileUrl: body.fileUrl,
      uploadToken: body.uploadToken,
    });
    if (!file.ok) return err("InvalidFileUrl", 400, { reason: file.reason });
    if (file.key && (await storageKeyInUse(prisma, file.key))) {
      return err("InvalidFileUrl", 400, { reason: "file_in_use" });
    }
    // The patient and the visit must be this clinic's, and the visit this
    // patient's: a document filed under someone else's appointment is sent
    // to someone else by «send to Telegram».
    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, clinicId: ctx.clinicId },
      select: { id: true },
    });
    if (!patient) return err("InvalidPatient", 400, { reason: "patient_not_found" });
    if (body.appointmentId) {
      const appointment = await prisma.appointment.findFirst({
        where: {
          id: body.appointmentId,
          patientId: body.patientId,
          clinicId: ctx.clinicId,
        },
        select: { id: true },
      });
      if (!appointment) {
        return err("InvalidAppointment", 400, {
          reason: "appointment_patient_mismatch",
        });
      }
    }

    // CD-05: a document is created signed only as the signature of this
    // patient's unsigned clinic consent, and is then a consent itself. A
    // bare «signed consent» with no consent text behind it was locked for
    // good (CD-09), even when it was a test scribble on the wrong card.
    const signs = Boolean(body.signsDocumentId);
    if (
      signs &&
      !(SIGNABLE_DOCUMENT_TYPES as readonly string[]).includes(body.type)
    ) {
      return err("BadRequest", 400, { reason: "signed_only_for_consent" });
    }
    let signsDocumentId: string | null = null;
    if (body.signsDocumentId) {
      const target = await prisma.document.findFirst({
        where: {
          id: body.signsDocumentId,
          patientId: body.patientId,
          clinicId: ctx.clinicId,
        },
      });
      if (!target || !canMarkSigned(target)) {
        return err("BadRequest", 400, { reason: "consent_not_signable" });
      }
      signsDocumentId = target.id;
    }
    const signedAt = signs ? new Date() : null;

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.document.create({
        data: {
          patientId: body.patientId,
          appointmentId: body.appointmentId ?? null,
          type: body.type,
          title: body.title,
          fileUrl: body.fileUrl,
          mimeType: body.mimeType ?? null,
          sizeBytes: body.sizeBytes ?? null,
          uploadedById,
          source: "STAFF",
          signedAt,
        } as never,
      });
      if (signsDocumentId) {
        // Conditional: a colleague who marked it signed a moment ago keeps
        // his timestamp.
        await tx.document.updateMany({
          where: { id: signsDocumentId, signedAt: null },
          data: { signedAt },
        });
      }
      // Surface the new document in the patient's Mini App /documents live.
      await publishViaOutbox(tx, {
        correlationId: newCorrelationId(),
        actor: {
          role: actorRole,
          userId: ctx.userId,
          patientId: null,
          onBehalfOfPatientId: null,
          label: `${ctx.role.toLowerCase()}:${ctx.userId}`,
        },
        surface,
        tenantScope: { clinicId: ctx.clinicId, patientId: body.patientId },
        type: "document.created",
        payload: {
          documentId: row.id,
          patientId: body.patientId,
          documentType: body.type,
        },
      });
      return row;
    });

    await audit(request, {
      action: "document.create",
      entityType: "Document",
      entityId: created.id,
      meta: { after: created },
    });
    if (signsDocumentId) {
      await audit(request, {
        action: "document.sign",
        entityType: "Document",
        entityId: signsDocumentId,
        meta: { signatureDocumentId: created.id, signedAt },
      });
    }
    return ok(withStaffFileUrl(created), 201);
  }
);
