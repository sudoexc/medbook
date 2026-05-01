/**
 * /api/crm/calls — list + create.
 * See docs/TZ.md §6.4 call-center.
 *
 * Phase 9d — gated behind `flags.hasCallCenter`. Basic-plan tenants get
 * 404 (matches the `/crm/call-center` page guard) so we don't leak the
 * pro-feature surface.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, parseQuery } from "@/server/http";
import { CreateCallSchema, QueryCallSchema } from "@/server/schemas/call";
import { ensureFeature } from "@/server/platform/feature-guard";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const block = await ensureFeature(ctx, "hasCallCenter");
    if (block) return block;
    const parsed = parseQuery(request, QueryCallSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.direction) where.direction = q.direction;
    if (q.operatorId) where.operatorId = q.operatorId;
    if (q.patientId) where.patientId = q.patientId;
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }
    if (q.q) {
      where.OR = [
        { fromNumber: { contains: q.q } },
        { toNumber: { contains: q.q } },
        { summary: { contains: q.q, mode: "insensitive" } },
      ];
    }

    const take = q.limit + 1;
    const rows = await prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        operator: { select: { id: true, name: true } },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({ rows, nextCursor });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"], bodySchema: CreateCallSchema },
  async ({ request, body, ctx }) => {
    const block = await ensureFeature(ctx, "hasCallCenter");
    if (block) return block;
    const created = await prisma.call.create({
      data: {
        direction: body.direction,
        fromNumber: body.fromNumber,
        toNumber: body.toNumber,
        patientId: body.patientId ?? null,
        operatorId: body.operatorId ?? null,
        appointmentId: body.appointmentId ?? null,
        durationSec: body.durationSec ?? null,
        recordingUrl: body.recordingUrl ?? null,
        summary: body.summary ?? null,
        tags: body.tags ?? [],
        sipCallId: body.sipCallId ?? null,
        endedAt: body.endedAt ?? null,
      } as never,
    });
    await audit(request, {
      action: "call.create",
      entityType: "Call",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);
