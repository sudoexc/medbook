import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff } from "@/server/http";
import { UpdateServiceSchema } from "@/server/schemas/service";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.service.findUnique({
      where: { id },
      include: { doctors: { include: { doctor: true } } },
    });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateServiceSchema },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.service.findUnique({ where: { id } });
    if (!before) return notFound();
    const after = await prisma.service.update({ where: { id }, data: body as never });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "service.update",
      entityType: "Service",
      entityId: id,
      meta: d,
    });
    return ok(after);
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.service.findUnique({ where: { id } });
    if (!before) return notFound();
    await prisma.service.update({ where: { id }, data: { isActive: false } });
    await audit(request, {
      action: "service.deactivate",
      entityType: "Service",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  }
);
