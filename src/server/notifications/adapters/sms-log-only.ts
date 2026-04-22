/**
 * LogOnly SMS adapter — doesn't call any external provider.
 * Records a fake `provider_id` so the worker flow is identical to real.
 *
 * Used as the default adapter until a clinic configures an `Eskiz` or
 * `Playmobile` provider in `/crm/settings/integrations` (Phase 4).
 */
import type { SmsAdapter, SmsSendResult } from "./sms";

export class LogOnlySmsAdapter implements SmsAdapter {
  readonly name = "log-only";

  async send(to: string, body: string): Promise<SmsSendResult> {
    const providerId = `logonly-sms-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    console.info(
      `[sms:log-only] to=${to} body=${body.slice(0, 80)}${body.length > 80 ? "..." : ""} providerId=${providerId}`,
    );
    return { providerId };
  }
}
