/**
 * /api/crm/canned-responses — list + create quick-reply snippets.
 *
 * Operators (all inbox roles) read; ADMIN writes. See
 * docs/TZ-telegram-section.md Layer 4. CannedResponse is tenant-scoped, so the
 * Prisma extension injects `clinicId` into where/data automatically.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, parseQuery } from "@/server/http";
import {
  CreateCannedResponseSchema,
  QueryCannedResponseSchema,
} from "@/server/schemas/canned-response";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryCannedResponseSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.lang) where.lang = q.lang;
    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: "insensitive" } },
        { body: { contains: q.q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.cannedResponse.findMany({
      where,
      orderBy: [{ lang: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return ok({ rows });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateCannedResponseSchema },
  async ({ request, body, ctx }) => {
    const createdById = ctx.kind === "TENANT" ? ctx.userId : null;
    const created = await prisma.cannedResponse.create({
      data: {
        title: body.title,
        body: body.body,
        lang: body.lang,
        sortOrder: body.sortOrder ?? 0,
        createdById,
      } as never,
    });
    await audit(request, {
      action: "canned.create",
      entityType: "CannedResponse",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);
