/**
 * STUB Eskiz / Playmobile SMS adapter.
 *
 * Phase 3a intentionally leaves the real HTTP call to Phase 4
 * `settings-integrations`. If the factory picks this adapter (because a
 * `ProviderConnection` row exists with `kind="SMS"` and `label="eskiz"`),
 * it will throw; the worker catches and marks the send FAILED.
 *
 * Why ship it empty? So the selector logic + types are wired. Phase 4
 * replaces `send()` without touching callers.
 */
import type { SmsAdapter, SmsSendResult } from "./sms";

export type EskizConfig = {
  baseUrl: string;
  email: string;
  password: string;
  sender?: string;
};

export class EskizSmsAdapter implements SmsAdapter {
  readonly name = "eskiz";

  constructor(private readonly _config: EskizConfig) {
    void this._config;
  }

  async send(_to: string, _body: string): Promise<SmsSendResult> {
    void _to;
    void _body;
    throw new Error(
      "EskizSmsAdapter: not configured — implement in Phase 4 (settings-integrations)",
    );
  }
}
