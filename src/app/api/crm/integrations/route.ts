/**
 * /api/crm/integrations — list + save ProviderConnection rows.
 *
 * See docs/TZ.md §8.1–§8.4. ADMIN only.
 *
 * ProviderConnection is in MODELS_TENANT_BYPASSABLE; Prisma still auto-scopes
 * under TENANT context but SYSTEM can bypass (out of scope here).
 *
 * Only a connection something actually reads may be saved here (audit
 * ST-05). The settings page used to store Payme / Click / Uzum keys, SIP
 * logins and a second Telegram "secret" that no code ever read, and then
 * showed the card green «Подключено». Now:
 *   - TELEGRAM is the connect wizard's job (`/api/crm/integrations/tg/*`):
 *     the bot runs on `Clinic.tgBotToken`, a row here changes nothing;
 *   - PAYME / CLICK / UZUM / OPENAI have no consumer: refused, nothing is
 *     stored that would look like a working integration;
 *   - OTHER / "sip" is the one consumer: the SIP webhook
 *     (`/api/calls/sip/event`) authenticates events with
 *     `config.webhookSecret`, which the old form never wrote, so every event
 *     got 401 in production. Saving it now generates that secret (or keeps
 *     the existing one) and the page shows it with the webhook address.
 *
 * Secrets in `secretCipher` are AES-256-GCM ciphertext via
 * `@/server/crypto/secrets`; plaintext is never returned, only a presence
 * flag and a last-4 mask.
 */
import { randomBytes } from "node:crypto";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { UpsertProviderSchema } from "@/server/schemas/settings";
import { decrypt, maskSecret } from "@/server/crypto/secrets";
import { telegramPublicOrigin } from "@/server/telegram/clinic-bot";

/** The only connection the clinic settings may save: the SIP webhook. */
const SIP_PROVIDER = { kind: "OTHER", label: "sip" } as const;

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

function configObject(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {};
}

/** Where the PBX posts its events (the secret goes in `x-sip-secret`). */
async function sipWebhookUrl(
  request: Request,
  clinicId: string,
): Promise<string | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { slug: true },
  });
  if (!clinic) return null;
  const origin = telegramPublicOrigin(request);
  return `${origin}/api/calls/sip/event?clinicSlug=${encodeURIComponent(clinic.slug)}`;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const rows = await prisma.providerConnection.findMany({
      where: { clinicId: ctx.clinicId },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
    });
    return ok({
      rows: rows.map((r) => redactConn(r as unknown as ConnRow)),
      sipWebhookUrl: await sipWebhookUrl(request, ctx.clinicId),
    });
  }
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpsertProviderSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    if (body.kind === "TELEGRAM") {
      return err("conflict", 409, { reason: "managed_by_wizard" });
    }
    const label = body.label ?? SIP_PROVIDER.label;
    if (body.kind !== SIP_PROVIDER.kind || label !== SIP_PROVIDER.label) {
      return err("conflict", 409, { reason: "provider_not_supported" });
    }
    if (body.secret !== undefined) {
      // No PBX adapter exists: a SIP password stored here reaches nothing.
      return err("ValidationError", 400, { reason: "secret_not_used" });
    }

    const existing = await prisma.providerConnection.findFirst({
      where: { clinicId: ctx.clinicId, kind: SIP_PROVIDER.kind, label },
    });
    const previousConfig = configObject(existing?.config);
    const previousSecret =
      typeof previousConfig.webhookSecret === "string" &&
      previousConfig.webhookSecret.length > 0
        ? previousConfig.webhookSecret
        : null;
    const webhookSecret =
      body.rotateWebhookSecret || !previousSecret
        ? randomBytes(24).toString("hex")
        : previousSecret;
    const config = { ...previousConfig, webhookSecret };

    const row = existing
      ? await prisma.providerConnection.update({
          where: { id: existing.id },
          data: {
            config: config as never,
            ...(body.active !== undefined ? { active: body.active } : {}),
          },
        })
      : await prisma.providerConnection.create({
          data: {
            clinicId: ctx.clinicId,
            kind: SIP_PROVIDER.kind,
            label,
            secretCipher: "",
            config: config as never,
            active: body.active ?? true,
          },
        });

    await audit(request, {
      action: existing ? "provider.update" : "provider.create",
      entityType: "ProviderConnection",
      entityId: row.id,
      // Never the secret itself.
      meta: {
        kind: SIP_PROVIDER.kind,
        label,
        webhookSecretIssued: webhookSecret !== previousSecret,
        active: row.active,
      },
    });
    return ok(
      {
        ...redactConn(row as unknown as ConnRow),
        sipWebhookUrl: await sipWebhookUrl(request, ctx.clinicId),
      },
      existing ? 200 : 201,
    );
  }
);
