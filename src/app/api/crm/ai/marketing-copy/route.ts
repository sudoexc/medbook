/**
 * /api/crm/ai/marketing-copy — Phase 15 Wave 4 marketing copy generator.
 *
 * POST { channel, audience, locale, maxChars?, tone?, promo?, customNotes?,
 * variants? } → MarketingCopyResult JSON.
 *
 * Roles allowed: ADMIN. SUPER_ADMIN passes through via the standard
 * `allowSuperAdmin: true` short-circuit; the impersonation cookie populates
 * `ctx.clinicId`.
 *
 * Rate limiting / cost accounting are handled inside `callLLM`. We
 * additionally write a `MARKETING_COPY_GENERATED` audit row at the route
 * level so the dashboard can slice "how many copy generations per day"
 * without scanning useCase strings on LLMUsage.
 */

import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import {
  generateMarketingCopy,
  type MarketingCopyChannel,
  type MarketingCopyAudience,
  type MarketingCopyTone,
  type MarketingCopyLocale,
} from "@/server/ai/marketing-copy";
import { LLMRateLimitError } from "@/server/ai/llm";
import { AUDIT_ACTION } from "@/lib/audit-actions";

const ChannelEnum = z.enum(["SMS", "TG", "EMAIL", "PUSH", "INAPP"]);
const AudienceEnum = z.enum([
  "reactivation",
  "birthday",
  "reminder",
  "no-show",
  "general",
]);
const ToneEnum = z.enum(["friendly", "professional", "urgent"]);
const LocaleEnum = z.enum(["ru", "uz"]);

const BodySchema = z.object({
  channel: ChannelEnum,
  audience: AudienceEnum,
  locale: LocaleEnum,
  maxChars: z.number().int().positive().max(5000).optional(),
  tone: ToneEnum.optional(),
  promo: z.string().max(500).optional(),
  customNotes: z.string().max(2000).optional(),
  variants: z.number().int().min(1).max(5).optional(),
});

export const POST = createApiHandler(
  {
    roles: ["ADMIN"],
    bodySchema: BodySchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }

    try {
      const result = await generateMarketingCopy({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        channel: body.channel as MarketingCopyChannel,
        audience: body.audience as MarketingCopyAudience,
        locale: body.locale as MarketingCopyLocale,
        maxChars: body.maxChars,
        tone: body.tone as MarketingCopyTone | undefined,
        promo: body.promo,
        customNotes: body.customNotes,
        variants: body.variants,
      });

      // Audit. Fire-and-forget; an audit failure must not block the
      // response. Mirrors the inline pattern in `/api/crm/ai/ask`.
      try {
        await prisma.auditLog.create({
          data: {
            clinicId: ctx.clinicId,
            action: AUDIT_ACTION.MARKETING_COPY_GENERATED,
            entityType: "LLMUsage",
            entityId: null,
            actorId: ctx.userId,
            actorRole: ctx.role ?? null,
            actorLabel: null,
            ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
              request.headers.get("x-real-ip") ?? null,
            userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
            meta: {
              channel: body.channel,
              audience: body.audience,
              locale: body.locale,
              variants_count: result.variants.length,
              costUzs: result.costUzs,
            } as never,
          },
        });
      } catch (auditErr) {
        console.error("[ai-marketing-copy:audit]", auditErr);
      }

      return ok(result);
    } catch (e) {
      if (e instanceof LLMRateLimitError) {
        return err("RateLimitExceeded", 429, { limit: e.limit });
      }
      console.error("[ai-marketing-copy]", e);
      return err("InternalError", 500);
    }
  },
);

export const GET = () => err("Method Not Allowed", 405);
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
