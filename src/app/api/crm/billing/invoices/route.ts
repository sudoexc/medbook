/**
 * GET /api/crm/billing/invoices — admin invoice list (cursor-paginated).
 *
 * Server-side scope is enforced by the tenant Prisma extension; we still
 * select clinicId-safe fields only. `amountTiins` is BigInt in Prisma so
 * we coerce to string on the wire — matches the SSR shape used by
 * `BillingClient`.
 *
 * Filters: optional `status` (single InvoiceStatus). Pagination follows
 * the codebase convention: take = limit+1 sentinel, cursor on id.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";

const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "VOID", "OVERDUE"] as const;

const QuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: { status?: (typeof INVOICE_STATUSES)[number] } = {};
    if (q.status) where.status = q.status;

    const take = q.limit + 1;
    const rows = await prisma.invoice.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: {
        id: true,
        number: true,
        status: true,
        amountTiins: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        dueAt: true,
        paidAt: true,
        createdAt: true,
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    return ok({
      rows: rows.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        amountTiins: i.amountTiins.toString(),
        currency: i.currency,
        periodStart: i.periodStart.toISOString(),
        periodEnd: i.periodEnd.toISOString(),
        dueAt: i.dueAt.toISOString(),
        paidAt: i.paidAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
      nextCursor,
    });
  },
);
