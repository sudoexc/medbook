/**
 * /api/crm/patients/[id] — get, patch, delete. See docs/TZ.md §6.5.
 *
 * Phase 17 Wave 1 — GET also records a PatientView audit row (5-minute
 * throttle) so PHI access is forensically reviewable from /crm/settings/audit.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
import { ok, notFound, conflict } from "@/server/http";
import {
  hydratePatientForRead,
  serializePatientForWrite,
} from "@/server/patient/cipher-fields";
import { UpdatePatientSchema } from "@/server/schemas/patient";
import { recordPatientView } from "@/server/audit/patient-view";
import {
  patientSnapshotAuditMeta,
  patientUpdateAuditMeta,
} from "@/server/audit/patient-audit-meta";
import {
  footprintFound,
  isForeignKeyViolation,
  lockPatientRow,
  patientFootprint,
} from "@/server/patient/footprint";
import { loadPatientFinance } from "@/server/patient/finance";
import { loadNextVisitAt } from "@/server/patient/next-visit";
import { clientIpForAudit } from "@/lib/client-ip";
import {
  findVerifiedPhoneOwners,
  isRealPhone,
  isUniqueViolation,
  releaseUnverifiedPhone,
} from "@/server/patient/phone-identity";
import {
  birthDateFromYear,
  birthYearOf,
  parsePatientIdentity,
} from "@/lib/patients/parse-identity";

/**
 * The update body plus `verifyPhone`: staff confirm, with the patient in
 * front of them or on the phone, that the number already on the card is
 * hers (audit PH-01). A number that arrived from the Mini App stays a mere
 * claim until then, and re-saving the form cannot bless it by accident.
 */
const PatchBody = UpdatePatientSchema.extend({
  verifyPhone: z.boolean().optional(),
});

/**
 * A name typed with the birth year, «Турматов Отабек 1969», is stored the
 * way POST /api/crm/patients stores it: the year goes to `birthDate`, the
 * name keeps only the name (a year left inside it breaks search, age and
 * the printed «г.р.» line). An explicit birth date in the same save wins,
 * and a full date already on the card is kept when its year agrees: the
 * name only ever carries a year, the card may know the day.
 */
function nameAndYearUpdate(
  fullName: string,
  birthDate: Date | null | undefined,
  current: Date | null | undefined,
): { fullName: string; birthDate?: Date } {
  const parsed = parsePatientIdentity(fullName);
  if (!parsed.matched || parsed.birthYear === null) return { fullName };
  if (birthDate) return { fullName: parsed.fullName };
  const sameYear =
    birthDate === undefined &&
    current != null &&
    birthYearOf(current) === parsed.birthYear;
  return sameYear
    ? { fullName: parsed.fullName }
    : { fullName: parsed.fullName, birthDate: birthDateFromYear(parsed.birthYear) };
}

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
        ip: clientIpForAudit(request),
        userAgent: request.headers.get("user-agent"),
      });
    }
    // `Patient.balance` is never written; every reader of this response
    // (the card, «Оплаты», the call-center and Telegram rails) gets the one
    // computed figure instead (audit PT-08).
    const finance = await loadPatientFinance(row.clinicId, id);
    // «Следующий визит» from the appointments; the column is never written
    // (audit PT-25).
    const nextVisits = await loadNextVisitAt([id]);
    return ok({
      ...hydratePatientForRead(row),
      nextVisitAt: nextVisits.get(id) ?? null,
      balance: finance.balance,
      finance,
    });
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: PatchBody,
  },
  async ({ request, body: rawBody }) => {
    const { verifyPhone, ...body } = rawBody;
    const id = idFromUrl(request);
    const before = await prisma.patient.findUnique({ where: { id } });
    if (!before) return notFound();
    // An erased card stays erased (audit PT-07): renaming it, or giving it
    // a phone, would put a person back on a record the patient had removed.
    if (before.deletedAt) return conflict("patient_erased");

    const data: Record<string, unknown> = serializePatientForWrite({ ...body });
    if (body.fullName !== undefined) {
      Object.assign(data, nameAndYearUpdate(body.fullName, body.birthDate, before.birthDate));
    }
    let phoneChanged = false;
    if (body.phone) {
      data.phoneNormalized = normalizePhone(body.phone);
      phoneChanged = data.phoneNormalized !== before.phoneNormalized;
      // A number staff typed is the clinic's own record of it (audit
      // PH-01). Re-saving the form with an unchanged number verifies
      // nothing: that would bless a number a Telegram user typed.
      if (phoneChanged) data.phoneVerifiedAt = new Date();
    }
    if (phoneChanged && typeof data.phoneNormalized === "string") {
      // The number is another patient's verified identity: say whose, so
      // the front desk can open that card instead of guessing (audit PT-01).
      // The unique index below still catches a race. Every owner is read:
      // this card may itself hold the old «+334125567» shape of the number
      // another card holds in full (LD-10), and the oldest alone was then
      // this card, so the clash surfaced as a nameless error.
      const owners = await findVerifiedPhoneOwners(
        prisma,
        before.clinicId,
        data.phoneNormalized,
      );
      const owner = owners.find((o) => o.id !== id);
      if (owner) {
        return conflict("phone_taken", {
          owner: { id: owner.id, fullName: owner.fullName },
        });
      }
    }
    if (
      verifyPhone &&
      !phoneChanged &&
      before.phoneVerifiedAt === null &&
      isRealPhone(before.phoneNormalized)
    ) {
      // The explicit «confirm the number» action: the Mini App claim becomes
      // the clinic's record, so the next walk-in finds this card instead of
      // asking about it again.
      data.phoneVerifiedAt = new Date();
    }

    let after;
    try {
      after = await prisma.$transaction(async (tx) => {
        if (phoneChanged && typeof data.phoneNormalized === "string") {
          await releaseUnverifiedPhone(
            tx,
            before.clinicId,
            data.phoneNormalized,
            "crm_update",
          );
        }
        return tx.patient.update({
          where: { id },
          data: data as never,
        });
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // The number is another card's verified identity, or the Telegram
      // account is bound to another card (one card per account, MA-04).
      return conflict("phone_or_telegram_taken");
    }
    const beforeHydrated = hydratePatientForRead(before);
    const afterHydrated = hydratePatientForRead(after);
    await audit(request, {
      action: "patient.update",
      entityType: "Patient",
      entityId: id,
      // Identity and note columns by name only (audit SEC-09): the diff of
      // the decrypted rows put the passport and notes in plain text here.
      meta: patientUpdateAuditMeta(beforeHydrated, afterHydrated),
    });
    // The card merges this answer into what GET gave it. The stored
    // `nextVisitAt` is never written (GET computes it, audit PT-25), so it
    // stays out of here: its NULL would blank «Следующий визит» until the
    // refetch.
    const { nextVisitAt: _neverWritten, ...fresh } = afterHydrated;
    return ok(fresh);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.patient.findUnique({ where: { id } });
    if (!before) return notFound();

    // Medico-legal guard (D-5, audit G1-09). A card with anything attached
    // (a visit, an allergy, a course of medication, a broadcast it received,
    // a DSAR request, a family link...) is never hard-deleted here: those
    // rows either cascade away with the card or restrict the delete (a raw
    // 500). Only an empty card created by mistake goes; a patient's request
    // to erase their data goes through the DSAR flow, which anonymizes with
    // retention checks. The count, the delete and its audit row share one
    // transaction under the card's row lock, so nothing lands in between.
    let outcome:
      | { deleted: true }
      | { deleted: false; gone?: true; counts: Record<string, number> };
    try {
      outcome = await prisma.$transaction(async (tx) => {
        await lockPatientRow(tx, id);
        const footprint = await patientFootprint(tx, id);
        // Deleted by someone else between the read and the lock.
        if (!footprint) return { deleted: false as const, gone: true as const, counts: {} };
        const counts = footprintFound(footprint);
        if (Object.keys(counts).length > 0) {
          return { deleted: false as const, counts };
        }
        await tx.patient.delete({ where: { id } });
        await tx.auditLog.create({
          data: {
            clinicId: before.clinicId,
            actorId: ctx.kind === "TENANT" || ctx.kind === "SUPER_ADMIN" ? ctx.userId : null,
            actorRole: ctx.kind === "TENANT" ? ctx.role : null,
            action: "patient.delete",
            entityType: "Patient",
            entityId: id,
            // The card without its identity (audit SEC-09): the row is gone,
            // and the audit log must not become the place it lives on.
            meta: patientSnapshotAuditMeta(
              hydratePatientForRead(before) as unknown as Record<string, unknown>,
            ) as never,
            ip: clientIpForAudit(request),
            userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
          },
        });
        return { deleted: true as const };
      });
    } catch (e) {
      // A row the count cannot see yet (a concurrent write that committed
      // first) still makes Postgres refuse: the same answer, not a 500.
      if (!isForeignKeyViolation(e)) throw e;
      outcome = { deleted: false, counts: {} };
    }
    if (!outcome.deleted) {
      if (outcome.gone) return notFound();
      return conflict("has_clinical_records", {
        useDsar: true,
        counts: outcome.counts,
      });
    }
    return ok({ id, deleted: true });
  }
);
