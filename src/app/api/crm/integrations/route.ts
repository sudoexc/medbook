/**
 * /api/crm/integrations — list + upsert ProviderConnection rows.
 *
 * See docs/TZ.md §8.1–§8.4. ADMIN only.
 *
 * ProviderConnection is in MODELS_TENANT_BYPASSABLE; Prisma still auto-scopes
 * under TENANT context but SYSTEM can bypass (out of scope here).
 *
 * Secrets are stored in `secretCipher` as base64 (placeholder for Phase 6 KMS).
 * `secret` is never returned — we only return a presence flag.
 */
import bcrypt from "bcryptjs";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { UpsertProviderSchema } from "@/server/schemas/settings";

type ConnRow = {
  id: string;
  clinicId: string;
  kind: string;
  label: string | null;
  secretCipher: string;
  config: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function redactConn(row: ConnRow) {
  return {
    id: row.id,
    clinicId: row.clinicId,
    kind: row.kind,
    label: row.label,
    hasSecret: Boolean(row.secretCipher),
    secretMasked: row.secretCipher ? "••••••••" : null,
    config: row.config,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Phase-4 placeholder cipher: base64. Real KMS wrapping added in Phase 6. */
function encryptSecret(plain: string): string {
  return Buffer.from(plain, "utf8").toString("base64");
}

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const rows = await prisma.providerConnection.findMany({
      where: { clinicId: ctx.clinicId },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
    });
    return ok({ rows: rows.map((r) => redactConn(r as unknown as ConnRow)) });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpsertProviderSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    // If the client is changing the secret, require password re-entry.
    if (body.secret !== undefined) {
      if (!body.currentPassword) {
        return err("Forbidden", 403, { reason: "password_required" });
      }
      const me = await prisma.user.findUnique({ where: { id: ctx.userId } });
      if (!me?.passwordHash) {
        return err("Forbidden", 403, { reason: "no_password" });
      }
      const okPw = await bcrypt.compare(body.currentPassword, me.passwordHash);
      if (!okPw) return err("Forbidden", 403, { reason: "wrong_password" });
    }

    const label = body.label ?? null;
    const existing = await prisma.providerConnection.findFirst({
      where: {
        clinicId: ctx.clinicId,
        kind: body.kind,
        label,
      },
    });

    let row;
    if (existing) {
      row = await prisma.providerConnection.update({
        where: { id: existing.id },
        data: {
          label,
          ...(body.secret !== undefined
            ? { secretCipher: encryptSecret(body.secret) }
            : {}),
          ...(body.config !== undefined ? { config: body.config as never } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
    } else {
      row = await prisma.providerConnection.create({
        data: {
          clinicId: ctx.clinicId,
          kind: body.kind,
          label,
          secretCipher: body.secret ? encryptSecret(body.secret) : "",
          config: (body.config ?? {}) as never,
          active: body.active ?? true,
        },
      });
    }

    await audit(request, {
      action: existing ? "provider.update" : "provider.create",
      entityType: "ProviderConnection",
      entityId: row.id,
      meta: {
        kind: body.kind,
        label,
        secretChanged: body.secret !== undefined,
        active: row.active,
      },
    });
    return ok(redactConn(row as unknown as ConnRow), existing ? 200 : 201);
  }
);
