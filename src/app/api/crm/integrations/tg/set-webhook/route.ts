/**
 * POST /api/crm/integrations/tg/set-webhook — register the clinic's webhook URL
 * with Telegram using the stored bot token + secret. ADMIN only.
 *
 * Expects JSON { baseUrl?: string } — optional, defaults to the origin of the
 * incoming request (useful when dev/prod URLs differ). Returns Telegram's
 * `setWebhook` result or a `notConfigured` flag if no token.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";

const Schema = z.object({
  baseUrl: z
    .string()
    .url()
    .optional(),
});

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: Schema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
    });
    if (!clinic) return err("NotFound", 404);
    if (!clinic.tgBotToken) {
      return err("Forbidden", 403, { reason: "not_configured" });
    }
    const origin = body.baseUrl ?? new URL(request.url).origin;
    const webhookUrl = `${origin}/api/telegram/webhook/${clinic.slug}`;

    if (process.env.MIDDLEBOOK_TG_STUB === "1") {
      await audit(request, {
        action: "tg.set_webhook",
        entityType: "Clinic",
        entityId: ctx.clinicId,
        meta: { url: webhookUrl, stub: true },
      });
      return ok({ ok: true, url: webhookUrl, stub: true });
    }

    const url = `https://api.telegram.org/bot${clinic.tgBotToken}/setWebhook`;
    const tgBody = {
      url: webhookUrl,
      ...(clinic.tgWebhookSecret
        ? { secret_token: clinic.tgWebhookSecret }
        : {}),
      allowed_updates: ["message", "callback_query", "my_chat_member"],
    };
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tgBody),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
      };
      await audit(request, {
        action: "tg.set_webhook",
        entityType: "Clinic",
        entityId: ctx.clinicId,
        meta: { url: webhookUrl, ok: data.ok === true },
      });
      if (data.ok !== true) {
        return err("tg_error", 502, {
          description: data.description ?? "unknown",
        });
      }
      return ok({ ok: true, url: webhookUrl });
    } catch (e) {
      console.error("[tg/set-webhook] fetch failed", e);
      return err("network_error", 502);
    }
  }
);
