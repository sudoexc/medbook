/**
 * GET /api/crm/telephony/status — whether calls really reach the CRM
 * (audit UX-08; the rule is in src/server/telephony/status.ts).
 *
 *   { connected, configured, webhookReady, lastEventAt }
 *
 * Reception shows the calls widget only when `connected`; the settings card
 * says «Подключено» only then.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import {
  loadTelephonyStatus,
  telephonyStatusFrom,
} from "@/server/telephony/status";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") {
      return ok(telephonyStatusFrom({ connection: null, lastProviderCallAt: null }));
    }
    return ok(await loadTelephonyStatus(prisma, ctx.clinicId));
  },
);
