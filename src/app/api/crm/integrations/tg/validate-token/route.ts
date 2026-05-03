/**
 * POST /api/crm/integrations/tg/validate-token — verify a Telegram bot token
 * by calling `getMe` and return a small preview the wizard can display.
 *
 * Request: { token: string }  (the raw `123456:AAH...` token from BotFather)
 * Response (ok):
 *   {
 *     bot: { id, username, firstName, canJoinGroups, supportsInline },
 *     alreadyBoundToOtherClinic?: { slug, label } | null
 *   }
 *
 * If the bot is already configured on a DIFFERENT clinic in this database,
 * we surface that fact so the wizard can warn the user before they overwrite
 * it. (Telegram itself only allows one webhook per bot — last writer wins —
 * so this guard prevents accidental cross-tenant theft.)
 *
 * ADMIN only. The token never touches Prisma here; persistence happens in
 * /connect after the user confirms.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { getMe } from "@/server/telegram/bot-api";

const Schema = z.object({
  token: z
    .string()
    .min(20)
    .max(80)
    .regex(/^\d+:[A-Za-z0-9_-]+$/, "format"),
});

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: Schema },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const resp = await getMe(body.token).catch((e) => {
      console.warn("[tg/validate-token] getMe network error", e);
      return null;
    });
    if (!resp) return err("network_error", 502);
    if (!resp.ok) {
      // Telegram returns 401 with description "Unauthorized" for bad tokens.
      const code = resp.error_code === 401 ? "invalid_token" : "tg_error";
      return err(code, 400, { description: resp.description });
    }
    const me = resp.result;

    // Look for the same bot already bound to another clinic so we can warn.
    // We compare by username (unique on Telegram). The current clinic itself
    // is excluded so re-running the wizard for the same bot is allowed.
    const other = await prisma.clinic.findFirst({
      where: {
        tgBotUsername: me.username,
        NOT: { id: ctx.clinicId },
      },
      select: { slug: true, nameRu: true },
    });

    return ok({
      bot: {
        id: me.id,
        username: me.username,
        firstName: me.first_name,
        canJoinGroups: Boolean(me.can_join_groups),
        supportsInline: Boolean(me.supports_inline_queries),
      },
      alreadyBoundToOtherClinic: other
        ? { slug: other.slug, label: other.nameRu }
        : null,
    });
  },
);
