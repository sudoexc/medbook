/**
 * /api/crm/patients — list + create. See docs/TZ.md §6.4.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
import { patientSearchWhere } from "@/server/patient/search-where";
import { patientBalanceIdWhere } from "@/server/patient/finance";
import {
  birthDateFromYear,
  parsePatientIdentity,
} from "@/lib/patients/parse-identity";
import { ok, err, parseQuery } from "@/server/http";
import {
  hydratePatientForRead,
  hydratePatientListForRead,
  serializePatientForWrite,
} from "@/server/patient/cipher-fields";
import {
  CreatePatientSchema,
  QueryPatientSchema,
} from "@/server/schemas/patient";
import { allocatePatientNumber } from "@/server/services/patient-number";
import { birthYearOf } from "@/lib/patients/identity-match";
import {
  contactPhoneStub,
  isUniqueViolation,
  releaseUnverifiedPhone,
  verifyPhoneInPerson,
} from "@/server/patient/phone-identity";
import {
  decidePhoneOwner,
  type PhoneOwnerDecision,
} from "@/server/patient/phone-owner";

/**
 * The create body plus staff's answer to «is this the number's owner?»
 * (audit Q-03), asked only when the typed name does not settle it.
 */
const CreateBody = CreatePatientSchema.extend({
  phoneOwner: z.enum(["same", "other"]).optional(),
});

/**
 * The 409 for a number that already leads to an existing card: either the
 * card to reuse (the dialogs book into it), or the card staff must be asked
 * about. A mismatch never hands out a reusable id: the booking dialog and
 * the inbox used to take that id and put a son's visit into his mother's
 * card.
 */
function existingCardConflict(
  decision: Exclude<PhoneOwnerDecision, { kind: "create" }>,
): Response {
  if (decision.kind === "ask") {
    return err("conflict", 409, {
      reason: "phone_owner_mismatch",
      owner: decision.owner,
    });
  }
  return err("conflict", 409, {
    reason: "phone_already_exists",
    patientId: decision.card.id,
  });
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryPatientSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.segment) where.segment = q.segment;
    if (q.source) where.source = q.source;
    if (q.gender) where.gender = q.gender;
    if (q.tag) where.tags = { has: q.tag };
    if (q.consent === "yes") where.consentMarketing = true;
    if (q.consent === "no") where.consentMarketing = false;
    // «Должники» on the computed balance (audit PT-08): the `balance` column
    // is never written, so filtering on it matched nobody, or everybody.
    if (q.balance && ctx.kind === "TENANT") {
      const idWhere = await patientBalanceIdWhere(ctx.clinicId, q.balance);
      if (idWhere) where.id = idWhere;
    }
    if (q.registeredFrom || q.registeredTo) {
      where.createdAt = {
        ...(q.registeredFrom ? { gte: q.registeredFrom } : {}),
        ...(q.registeredTo ? { lte: q.registeredTo } : {}),
      };
    }
    // Name / phone / passport / Telegram, and «Фамилия ГГГГ» (audit PT-03).
    const search = patientSearchWhere(q.q);
    if (search) where.AND = [search];

    const take = q.limit + 1;
    const rows = await prisma.patient.findMany({
      where,
      orderBy: { [q.sort]: q.dir },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    const total = await prisma.patient.count({ where });

    // Segment-tab badge counts: respect every other filter except segment,
    // so switching tabs doesn't zero out the others. groupBy returns rows
    // for segments that have ≥1 match — fill missing buckets with 0.
    const { segment: _omit, ...whereWithoutSegment } = where;
    const grouped = await prisma.patient.groupBy({
      by: ["segment"],
      where: whereWithoutSegment,
      _count: { _all: true },
    });
    const segmentCounts: Record<
      "VIP" | "NEW" | "ACTIVE" | "DORMANT" | "CHURN",
      number
    > = { VIP: 0, NEW: 0, ACTIVE: 0, DORMANT: 0, CHURN: 0 };
    let totalAcrossSegments = 0;
    for (const row of grouped) {
      const seg = row.segment as keyof typeof segmentCounts;
      const c = row._count?._all ?? 0;
      if (seg in segmentCounts) segmentCounts[seg] = c;
      totalAcrossSegments += c;
    }

    return ok({
      rows: hydratePatientListForRead(rows),
      nextCursor,
      total,
      segmentCounts,
      totalAcrossSegments,
    });
  }
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: CreateBody,
  },
  async ({ request, body, ctx }) => {
    const phoneNormalized = normalizePhone(body.phone);
    if (!phoneNormalized) {
      return err("ValidationError", 400, { reason: "invalid_phone" });
    }

    // The clinic types «Турматов Отабек 1969» into one field — the doctor's
    // walk-in dialog already understands that, and the front desk creating
    // the same patient must not be the one path that stores the year inside
    // the name (it breaks search, the printed «г.р.» line and age). Parse
    // here so every create path agrees. An explicit birthDate from the form
    // always wins: it carries a full date, the name only ever a year.
    const parsedIdentity = parsePatientIdentity(body.fullName);
    const fullName = parsedIdentity.matched
      ? parsedIdentity.fullName
      : body.fullName;
    const birthDate =
      body.birthDate ??
      (parsedIdentity.birthYear !== null
        ? birthDateFromYear(parsedIdentity.birthYear)
        : null);

    if (ctx.kind !== "TENANT") {
      return err("forbidden", 403, { reason: "tenant_required" });
    }
    const clinicId = ctx.clinicId;

    // «This patient already exists» is decided the way the walk-in decides
    // it (audit Q-03, PH-01): a verified owner whose name and birth year
    // match, a relative registered under the number by name, or a card
    // staff explicitly confirmed. A different name, or a card that merely
    // claims the number (typed into the Mini App), is a question for staff,
    // never a silent reuse.
    const probe = {
      fullName,
      birthYear: birthDate ? birthYearOf(birthDate) : parsedIdentity.birthYear,
    };
    const decide = () =>
      decidePhoneOwner(prisma, clinicId, phoneNormalized, probe, body.phoneOwner);
    const decision = await decide();
    if (decision.kind === "use" && decision.verifyClaim) {
      // Staff confirmed a Mini App claim is this patient (at the desk or on
      // the phone with her): her Telegram card becomes the clinic's card
      // instead of a duplicate taking the number away from it.
      await verifyPhoneInPerson(prisma, clinicId, decision.card.id, "crm_create");
    }
    if (decision.kind !== "create") return existingCardConflict(decision);
    const { asContact } = decision;

    // Allocate the per-clinic patient number and create the row inside a
    // transaction so a unique-violation on the resulting (clinicId,
    // patientNumber) pair rolls back the counter bump as well.
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        if (!asContact) {
          await releaseUnverifiedPhone(tx, clinicId, phoneNormalized, "crm_create");
        }
        const patientNumber = await allocatePatientNumber(clinicId, tx);
        const writeData = serializePatientForWrite({
          fullName,
          // A relative using an owned number (staff answered «other»)
          // keeps it as a contact phone: a `contact:` stub keeps the unique
          // index intact and the number is never taken for his identity.
          // Stored canonical, so the next visit finds him by it.
          phone: asContact ? phoneNormalized : body.phone,
          phoneNormalized: asContact ? contactPhoneStub() : phoneNormalized,
          // Typed by staff for the person in front of them (or on the phone
          // with them): the clinic's own record of the number.
          phoneVerifiedAt: asContact ? null : new Date(),
          birthDate,
          gender: body.gender ?? null,
          passport: body.passport ?? null,
          address: body.address ?? null,
          photoUrl: body.photoUrl ?? null,
          telegramId: body.telegramId ?? null,
          telegramUsername: body.telegramUsername ?? null,
          preferredChannel: body.preferredChannel ?? "TG",
          preferredLang: body.preferredLang ?? "RU",
          source: body.source ?? null,
          segment: body.segment ?? "NEW",
          tags: body.tags ?? [],
          notes: body.notes ?? null,
          discountPct: body.discountPct ?? 0,
          consentMarketing: body.consentMarketing ?? false,
        });
        return tx.patient.create({
          data: { ...writeData, patientNumber } as never, // tenant ext injects clinicId
        });
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // A concurrent create took the number, or the Telegram account is
      // already bound to another card (one card per account, audit MA-04).
      const again = await decide();
      if (again.kind !== "create") return existingCardConflict(again);
      return err("conflict", 409, { reason: "telegram_already_linked" });
    }
    const hydrated = hydratePatientForRead(created);
    await audit(request, {
      action: "patient.create",
      entityType: "Patient",
      entityId: created.id,
      // Audit meta carries the plaintext snapshot for forensic reconstruction —
      // the audit table is itself sensitive but is a single sink we already
      // trust. The DB row stays encrypted regardless.
      meta: { after: hydrated },
    });
    return ok(hydrated, 201);
  }
);
