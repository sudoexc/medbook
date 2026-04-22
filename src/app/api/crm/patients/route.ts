/**
 * /api/crm/patients — list + create. See docs/TZ.md §6.4.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreatePatientSchema,
  QueryPatientSchema,
} from "@/server/schemas/patient";

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
      const norm = normalizePhone(q.q);
      where.OR = [
        { fullName: { contains: q.q, mode: "insensitive" } },
        { phone: { contains: q.q } },
        { phoneNormalized: { contains: norm } },
        { passport: { contains: q.q, mode: "insensitive" } },
        { telegramUsername: { contains: q.q, mode: "insensitive" } },
      ];
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
    return ok({ rows, nextCursor, total });
  }
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: CreatePatientSchema,
  },
  async ({ request, body }) => {
    const phoneNormalized = normalizePhone(body.phone);
    if (!phoneNormalized) {
      return err("ValidationError", 400, { reason: "invalid_phone" });
    }

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

    const created = await prisma.patient.create({
      data: {
        fullName: body.fullName,
        phone: body.phone,
        phoneNormalized,
        birthDate: body.birthDate ?? null,
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
      } as never, // tenant-scope extension injects clinicId
    });
    await audit(request, {
      action: "patient.create",
      entityType: "Patient",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);
