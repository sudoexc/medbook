/**
 * /api/crm/calls/[id] — get, patch (summary/tags/link patient/appt).
 * See docs/TZ.md §6.4.
 *
 * Phase 9d — gated behind `flags.hasCallCenter` (404 on basic-tier).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff } from "@/server/http";
import { UpdateCallSchema } from "@/server/schemas/call";
import { ensureFeature } from "@/server/platform/feature-guard";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const block = await ensureFeature(ctx, "hasCallCenter");
    if (block) return block;
    const id = idFromUrl(request);
    const row = await prisma.call.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        operator: { select: { id: true, name: true } },
      },
    });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"], bodySchema: UpdateCallSchema },
  async ({ request, body, ctx }) => {
    const block = await ensureFeature(ctx, "hasCallCenter");
    if (block) return block;
    const id = idFromUrl(request);
    const before = await prisma.call.findUnique({ where: { id } });
    if (!before) return notFound();
    const after = await prisma.call.update({
      where: { id },
      data: body as never,
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "call.update",
      entityType: "Call",
      entityId: id,
      meta: d,
    });
    return ok(after);
  }
);
