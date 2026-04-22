import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff } from "@/server/http";
import { UpdateCabinetSchema } from "@/server/schemas/cabinet";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.cabinet.findUnique({ where: { id } });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateCabinetSchema },
  async ({ request, body }) => {
    const id = idFromUrl(request);
    const before = await prisma.cabinet.findUnique({ where: { id } });
    if (!before) return notFound();
    const after = await prisma.cabinet.update({ where: { id }, data: body as never });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "cabinet.update",
      entityType: "Cabinet",
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
    const before = await prisma.cabinet.findUnique({ where: { id } });
    if (!before) return notFound();
    await prisma.cabinet.update({ where: { id }, data: { isActive: false } });
    await audit(request, {
      action: "cabinet.deactivate",
      entityType: "Cabinet",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deactivated: true });
  }
);
