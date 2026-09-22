/**
 * /api/crm/patients — list + create. See docs/TZ.md §6.4.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
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

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
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
    if (q.balance === "debt") where.balance = { lt: 0 };
    if (q.balance === "zero") where.balance = 0;
    if (q.balance === "credit") where.balance = { gt: 0 };
    if (q.registeredFrom || q.registeredTo) {
      where.createdAt = {
        ...(q.registeredFrom ? { gte: q.registeredFrom } : {}),
        ...(q.registeredTo ? { lte: q.registeredTo } : {}),
      };
    }
    if (q.q) {
      const term = q.q.trim();
      const phoneDigits = term.replace(/\D/g, "");
      const phoneNorm = normalizePhone(term);
      // Wave 4 note: `passport` is stored encrypted; `contains` only matches
      // legacy plaintext rows. Searching encrypted passports is out of scope
      // and would require a blind-index (HMAC) column — see runbook.
      const or: Array<Record<string, unknown>> = [
        { fullName: { contains: term, mode: "insensitive" } },
        { passport: { contains: term, mode: "insensitive" } },
        { telegramUsername: { contains: term, mode: "insensitive" } },
      ];
      if (phoneDigits.length >= 3) {
        or.push({ phone: { contains: term } });
        or.push({ phoneNormalized: { contains: phoneDigits } });
        if (phoneNorm) or.push({ phoneNormalized: { contains: phoneNorm } });
      }
      // The doctor records patients as «Турматов О 1969» and searches the same
      // way. The year now lives in `birthDate` instead of inside the name, so
      // a trailing year has to match on the date or his habit would silently
      // stop finding people.
      const yearMatch = term.match(/(?:^|\s)((?:19|20)\d{2})\s*$/);
      const year = yearMatch ? Number(yearMatch[1]) : null;
      if (year !== null && year >= 1900 && year <= new Date().getFullYear()) {
        const range = {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        };
        const namePart = term.slice(0, yearMatch!.index ?? 0).trim();
        if (namePart) {
          // «Турматов 1969» — name AND year must both hold, otherwise a query
          // naming someone specific would return every patient born that year.
          where.AND = [
            { fullName: { contains: namePart, mode: "insensitive" } },
            { birthDate: range },
          ];
        } else {
          or.push({ birthDate: range });
        }
      }
      where.OR = or;
    }

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
    bodySchema: CreatePatientSchema,
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

    // unique (clinicId, phoneNormalized) — look up composite key
    const existing = await prisma.patient.findFirst({
      where: { phoneNormalized },
      select: { id: true },
    });
    if (existing) {
      return err("conflict", 409, {
        reason: "phone_already_exists",
        patientId: existing.id,
      });
    }

    // Allocate the per-clinic patient number and create the row inside a
    // transaction so a unique-violation on the resulting (clinicId,
    // patientNumber) pair rolls back the counter bump as well.
    if (ctx.kind !== "TENANT") {
      return err("forbidden", 403, { reason: "tenant_required" });
    }
    const clinicId = ctx.clinicId;
    const created = await prisma.$transaction(async (tx) => {
      const patientNumber = await allocatePatientNumber(clinicId, tx);
      const writeData = serializePatientForWrite({
        fullName,
        phone: body.phone,
        phoneNormalized,
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
