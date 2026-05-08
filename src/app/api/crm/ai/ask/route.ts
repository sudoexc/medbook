/**
 * /api/crm/ai/ask — Phase 15 Wave 3 NL Command Bar endpoint.
 *
 * POST { question: string, locale: 'ru' | 'uz' } → AskAssistantResult JSON.
 *
 * Roles allowed: ADMIN, DOCTOR, RECEPTIONIST, NURSE. SUPER_ADMIN passes
 * through via the standard `allowSuperAdmin: true` short-circuit; the
 * impersonation cookie populates `ctx.clinicId`.
 *
 * Rate limiting / cost accounting are handled inside `callLLM` (the
 * loop calls it per iteration). We additionally write an `AI_QUERY_ASKED`
 * audit row at the route level so the dashboard can slice "NL queries per
 * clinic per day" without joining LLMUsage.
 */

import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { askAssistant } from "@/server/ai/tool-loop";
import { LLMRateLimitError } from "@/server/ai/llm";
import { AUDIT_ACTION } from "@/lib/audit-actions";

const BodySchema = z.object({
  question: z.string().min(2).max(2000),
  locale: z.enum(["ru", "uz"]),
});

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE"],
    bodySchema: BodySchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }

    try {
      const result = await askAssistant({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        locale: body.locale,
        question: body.question,
      });

      // Audit. Fire-and-forget; an audit failure must not block the
      // response. Match the shared `audit()` helper's posture but inline
      // because we want extra meta beyond the entityType/entityId pair.
      try {
        await prisma.auditLog.create({
          data: {
            clinicId: ctx.clinicId,
            action: AUDIT_ACTION.AI_QUERY_ASKED,
            entityType: "LLMUsage",
            entityId: null,
            actorId: ctx.userId,
            actorRole: ctx.role ?? null,
            actorLabel: null,
            ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
              request.headers.get("x-real-ip") ?? null,
            userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
            meta: {
              question_preview: body.question.slice(0, 100),
              locale: body.locale,
              toolsUsed: result.toolTrace.map((t) => t.name),
              costUzs: result.costUzs,
            } as never,
          },
        });
      } catch (auditErr) {
        console.error("[ai-ask:audit]", auditErr);
      }

      return ok(result);
    } catch (e) {
      if (e instanceof LLMRateLimitError) {
        return err("RateLimitExceeded", 429, { limit: e.limit });
      }
      console.error("[ai-ask]", e);
      return err("InternalError", 500);
    }
  },
);

export const GET = () => err("Method Not Allowed", 405);
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
