/**
 * /api/crm/integrations — list + upsert ProviderConnection rows.
 *
 * See docs/TZ.md §8.1–§8.4. ADMIN only.
 *
 * ProviderConnection is in MODELS_TENANT_BYPASSABLE; Prisma still auto-scopes
 * under TENANT context but SYSTEM can bypass (out of scope here).
 *
 * Secrets are stored in `secretCipher` as AES-256-GCM ciphertext via
 * `@/server/crypto/secrets`. `secret` plaintext is never returned — only a
 * presence flag and a last-4 mask derived from the decrypted value.
 */
import bcrypt from "bcryptjs";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { UpsertProviderSchema } from "@/server/schemas/settings";
import { encrypt, decrypt, maskSecret } from "@/server/crypto/secrets";

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
  let secretMasked: string | null = null;
  if (row.secretCipher) {
    try {
      secretMasked = maskSecret(decrypt(row.secretCipher));
    } catch {
      // Legacy base64 rows from before the AES-GCM migration, or tampered
      // ciphertext. Fall back to an opaque placeholder rather than 500.
      secretMasked = "••••";
    }
  }
  return {
    id: row.id,
    clinicId: row.clinicId,
    kind: row.kind,
    label: row.label,
    hasSecret: Boolean(row.secretCipher),
    secretMasked,
    config: row.config,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
            ? { secretCipher: encrypt(body.secret) }
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
          secretCipher: body.secret ? encrypt(body.secret) : "",
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
