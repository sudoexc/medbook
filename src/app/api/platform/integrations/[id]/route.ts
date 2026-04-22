/**
 * PATCH  /api/platform/integrations/[id] — update provider-connection fields.
 * DELETE /api/platform/integrations/[id] — hard delete.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { encrypt } from "@/server/crypto/secrets";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import { PatchPlatformIntegrationSchema } from "@/server/schemas/platform";

function idFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/platform/integrations/[id]
    //  0   1        2            3
    return segs[3] ?? null;
  } catch {
    return null;
  }
}

async function requireSuper(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: err("Unauthorized", 401) };
  if (session.user.role !== "SUPER_ADMIN") {
    return { ok: false, response: err("Forbidden", 403) };
  }
  return { ok: true, userId: session.user.id };
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = idFromUrl(request);
    if (!id) return err("BadRequest", 400);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return err("InvalidJson", 400);
    }
    const parsed = PatchPlatformIntegrationSchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }
    const existing = await prisma.providerConnection.findUnique({
      where: { id },
    });
    if (!existing) return notFound();
    const updated = await prisma.providerConnection.update({
      where: { id },
      data: {
        ...(parsed.data.label !== undefined ? { label: parsed.data.label ?? null } : {}),
        ...(parsed.data.secret !== undefined
          ? { secretCipher: encrypt(parsed.data.secret) }
          : {}),
        ...(parsed.data.config !== undefined
          ? { config: (parsed.data.config ?? {}) as never }
          : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      },
    });
    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: existing.clinicId,
      action: "integration.update",
      entityType: "ProviderConnection",
      entityId: id,
      meta: {
        changed: Object.keys(parsed.data),
        secretChanged: parsed.data.secret !== undefined,
      },
    });
    return ok({ id: updated.id, active: updated.active });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = idFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const existing = await prisma.providerConnection.findUnique({
      where: { id },
    });
    if (!existing) return notFound();
    await prisma.providerConnection.delete({ where: { id } });
    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: existing.clinicId,
      action: "integration.delete",
      entityType: "ProviderConnection",
      entityId: id,
      meta: { kind: existing.kind, label: existing.label },
    });
    return ok({ id });
  });
}
