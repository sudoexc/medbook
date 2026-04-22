/**
 * /api/crm/exchange-rates — list + upsert FX rates (USD→UZS).
 * See docs/TZ.md §6.8.
 *
 * ExchangeRate is in MODELS_TENANT_BYPASSABLE — but tenant-bound admins
 * still see only their own rates because `clinicId` is required on the model
 * and we run inside runWithTenant(TENANT). Nothing special to bypass here.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, parseQuery } from "@/server/http";
import {
  CreateExchangeRateSchema,
  QueryExchangeRateSchema,
} from "@/server/schemas/exchange-rate";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryExchangeRateSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.from || q.to) {
      where.date = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }
    const rows = await prisma.exchangeRate.findMany({
      where,
      orderBy: { date: "desc" },
      take: q.limit,
    });
    return ok({ rows });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateExchangeRateSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") {
      return ok({ error: "Forbidden" }, 403);
    }
    // Upsert by clinicId+date.
    const created = await prisma.exchangeRate.upsert({
      where: {
        clinicId_date: { clinicId: ctx.clinicId, date: body.date },
      },
      create: {
        date: body.date,
        rateUsd: body.rateUsd,
        source: body.source ?? null,
      } as never,
      update: {
        rateUsd: body.rateUsd,
        source: body.source ?? null,
      },
    });
    await audit(request, {
      action: "fx.upsert",
      entityType: "ExchangeRate",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created);
  }
);
