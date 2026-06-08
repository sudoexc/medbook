/**
 * /api/crm/integrations/sms/test — REMOVED (SMS removal Wave 1).
 *
 * Returns 410 Gone with code "SmsRemoved". Settings UI still pointing here
 * gets a clear, non-retried failure. Full deletion of the file follows in
 * Wave 3 along with the schema (`TestSmsSchema`) and the settings card.
 *
 * See `docs/TZ-sms-removal.md` §3.3 / §4 (Wave 1).
 */
import { createApiHandler } from "@/lib/api-handler";
import { err } from "@/server/http";

export const POST = createApiHandler(
  { roles: ["ADMIN"] },
  async () => err("SmsRemoved", 410),
);
