/**
 * POST /api/crm/notifications/templates/[id]/test-send — the template
 * editor's «Тестовая отправка» (audit UX-10).
 *
 * Sends the SAVED template to the signed-in admin's own Telegram through the
 * clinic bot, rendered like a real reminder (see
 * `@/server/notifications/template-test`). It used to queue a
 * NotificationSend for a made-up patient and always ended in a 500.
 *
 * Answers:
 *   200 { sent: true }                       Telegram accepted the message
 *   409 { reason: "channel_not_supported" }  not a Telegram template
 *   409 { reason: "bot_not_connected" }      the clinic has no bot
 *   409 { reason: "no_staff_telegram" }      no Telegram id on the account
 *   409 { reason: "staff_not_started_bot" | "staff_blocked_bot" }
 *   502 { reason: "tg_timeout" | "tg_error" }
 * Nothing is written to NotificationSend.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { ok, err, notFound } from "@/server/http";
import { render } from "@/server/notifications/template";
import {
  TemplateTestSendSchema,
  templateTestContext,
  templateTestFailure,
  templateTestRefusal,
} from "@/server/notifications/template-test";
import { sendMessage } from "@/server/telegram/send";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /api/crm/notifications/templates/[id]/test-send → id is second-to-last
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: TemplateTestSendSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    // Each test is a real Telegram message; a stuck button must not flood.
    if (!rateLimit(`template-test:${ctx.userId}`, 10, 10 * 60 * 1000)) {
      return err("RateLimited", 429);
    }

    const tpl = await prisma.notificationTemplate.findUnique({
      where: { id: idFromUrl(request) },
      select: { id: true, channel: true, bodyRu: true, bodyUz: true },
    });
    if (!tpl) return notFound();

    // User is not tenant-scoped: the clinic filter is explicit.
    const [me, clinic] = await Promise.all([
      prisma.user.findFirst({
        where: { id: ctx.userId, clinicId: ctx.clinicId },
        select: { telegramId: true },
      }),
      prisma.clinic.findUnique({
        where: { id: ctx.clinicId },
        select: {
          id: true,
          slug: true,
          nameRu: true,
          nameUz: true,
          phone: true,
          addressRu: true,
          tgBotToken: true,
          tgBotUsername: true,
        },
      }),
    ]);
    if (!clinic) return notFound();

    const refusal = templateTestRefusal({
      channel: tpl.channel,
      // Checked here, not left to sendMessage: with no token it logs and
      // returns a made-up message id, which must never read as «sent».
      botConnected: Boolean(clinic.tgBotToken),
      staffTelegramId: me?.telegramId,
    });
    if (refusal) return err("conflict", 409, { reason: refusal });

    const lang = body.locale === "uz" && tpl.bodyUz.trim() !== "" ? "uz" : "ru";
    const text = render(
      lang === "uz" ? tpl.bodyUz : tpl.bodyRu,
      templateTestContext(body.sample, clinic, lang),
    );

    try {
      await sendMessage(clinic, me!.telegramId!.trim(), text, {
        parse_mode: "HTML",
        delivery: { retryUncertain: false },
      });
    } catch (e) {
      const failure = templateTestFailure(e instanceof Error ? e.message : String(e));
      return err("TelegramFailed", failure.status, { reason: failure.reason });
    }
    return ok({ sent: true });
  },
);
