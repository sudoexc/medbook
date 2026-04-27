/**
 * GET /api/crm/integrations/tg/webhook-status — proxies Telegram's
 * `getWebhookInfo` call for the clinic's bot token. ADMIN only.
 *
 * In dev without `tgBotToken`, returns a stub { url: null, notConfigured: true }
 * so the UI can render a helpful state without hitting Telegram.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";

type TgWebhookInfo = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  ip_address?: string;
  allowed_updates?: string[];
};

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
    });
    if (!clinic) return err("NotFound", 404);
    if (!clinic.tgBotToken) {
      return ok({
        notConfigured: true,
        botUsername: clinic.tgBotUsername ?? null,
      });
    }
    // In test/dev with no network, allow an explicit bypass via header-less stub.
    if (process.env.MIDDLEBOOK_TG_STUB === "1") {
      return ok({
        notConfigured: false,
        botUsername: clinic.tgBotUsername ?? null,
        webhook: {
          url: "https://example.test/api/telegram/webhook/stub",
          pending_update_count: 0,
          last_error_date: null,
          last_error_message: null,
        } as const,
        hasSecret: Boolean(clinic.tgWebhookSecret),
      });
    }
    try {
      const url = `https://api.telegram.org/bot${clinic.tgBotToken}/getWebhookInfo`;
      const resp = await fetch(url, { method: "GET" });
      const json = (await resp.json().catch(() => null)) as
        | { ok: true; result: TgWebhookInfo }
        | { ok: false; description?: string }
        | null;
      if (!json || !("ok" in json)) {
        return ok({
          notConfigured: false,
          botUsername: clinic.tgBotUsername ?? null,
          error: "invalid_response",
        });
      }
      if (!json.ok) {
        return ok({
          notConfigured: false,
          botUsername: clinic.tgBotUsername ?? null,
          error: json.description ?? "telegram_error",
        });
      }
      const info = json.result;
      return ok({
        notConfigured: false,
        botUsername: clinic.tgBotUsername ?? null,
        webhook: {
          url: info.url ?? null,
          pending_update_count: info.pending_update_count ?? 0,
          last_error_date: info.last_error_date ?? null,
          last_error_message: info.last_error_message ?? null,
          has_custom_certificate: info.has_custom_certificate ?? false,
          max_connections: info.max_connections ?? null,
          ip_address: info.ip_address ?? null,
        },
        hasSecret: Boolean(clinic.tgWebhookSecret),
      });
    } catch (e) {
      console.error("[tg/webhook-status] fetch failed", e);
      return ok({
        notConfigured: false,
        botUsername: clinic.tgBotUsername ?? null,
        error: "network_error",
      });
    }
  }
);
