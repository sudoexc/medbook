/**
 * Real Telegram adapter — delegates to `src/server/telegram/send.ts`.
 *
 * Loaded by the adapter factory when `ProviderConnection.kind = TELEGRAM`
 * AND the clinic has a `tgBotToken` configured. When the token is missing
 * the send module falls back to log-only internally, so templates still
 * appear "delivered" in dev.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { sendMessage, type TgClinicMinimal } from "@/server/telegram/send";
import type { TgAdapter, TgSendResult } from "./tg";

export class TelegramClinicAdapter implements TgAdapter {
  readonly name = "telegram";

  constructor(private readonly clinicId: string) {}

  async send(chatId: string, body: string): Promise<TgSendResult> {
    const clinic = await runWithTenant({ kind: "SYSTEM" }, async () =>
      prisma.clinic.findUnique({
        where: { id: this.clinicId },
        select: {
          id: true,
          slug: true,
          tgBotToken: true,
          tgBotUsername: true,
        },
      }),
    );
    if (!clinic) {
      throw new Error(`TelegramClinicAdapter: clinic ${this.clinicId} not found`);
    }
    const clinicMin: TgClinicMinimal = {
      id: clinic.id,
      slug: clinic.slug,
      tgBotToken: clinic.tgBotToken,
      tgBotUsername: clinic.tgBotUsername,
    };
    const res = await sendMessage(clinicMin, chatId, body, { parse_mode: "HTML" });
    return { messageId: res.message_id };
  }
}
