/**
 * DELETE /api/crm/integrations/[id] — disconnect a provider (soft: active=false).
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const DELETE = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const row = await prisma.providerConnection.findFirst({
      where: { id, clinicId: ctx.clinicId },
    });
    if (!row) return notFound();
    await prisma.providerConnection.update({
      where: { id },
      data: { active: false },
    });
    await audit(request, {
      action: "provider.deactivate",
      entityType: "ProviderConnection",
      entityId: id,
      meta: { kind: row.kind, label: row.label },
    });
    return ok({ id, deactivated: true });
  }
);
