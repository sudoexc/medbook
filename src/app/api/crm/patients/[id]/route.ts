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
import { ok, notFound, conflict, diff } from "@/server/http";
import {
  hydratePatientForRead,
  serializePatientForWrite,
} from "@/server/patient/cipher-fields";
import { UpdatePatientSchema } from "@/server/schemas/patient";
import { recordPatientView } from "@/server/audit/patient-view";
import { clientIpForAudit } from "@/lib/client-ip";
import {
  findVerifiedPhoneOwner,
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
    return ok(hydratePatientForRead(row));
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
      // The unique index below still catches a race.
      const owner = await findVerifiedPhoneOwner(
        prisma,
        before.clinicId,
        data.phoneNormalized,
      );
      if (owner && owner.id !== id) {
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

    // Medico-legal guard (D-5). A patient with any clinical or financial
    // footprint must never be hard-deleted here: appointment / visit-note /
    // document / payment FKs are ON DELETE RESTRICT, so prisma.delete() would
    // throw a raw FK violation, and — more importantly — finalized conclusions
    // and signed documents are legal records that must outlive the patient
    // row. Send the admin to the DSAR deletion flow (POST /api/crm/dsar/
    // deletions), which anonymizes or schedules a reviewed hard-delete with
    // retention checks instead of destroying records. Hard-delete stays
    // allowed only for a footprint-free patient (created by mistake).
    const [appointments, visitNotes, documents, payments, cases] =
      await Promise.all([
        prisma.appointment.count({ where: { patientId: id } }),
        prisma.visitNote.count({ where: { patientId: id } }),
        prisma.document.count({ where: { patientId: id } }),
        prisma.payment.count({ where: { patientId: id } }),
        prisma.medicalCase.count({ where: { patientId: id } }),
      ]);
    if (appointments + visitNotes + documents + payments + cases > 0) {
      return conflict("has_clinical_records", {
        useDsar: true,
        counts: { appointments, visitNotes, documents, payments, cases },
      });
    }

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
