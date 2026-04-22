/**
 * SMS adapter interface.
 *
 * Real implementations: Eskiz.uz (primary for Uzbekistan), Playmobile
 * (fallback). Both land in Phase 4 `settings-integrations` where
 * `ProviderConnection` rows hold encrypted credentials.
 *
 * Until then — `LogOnlySmsAdapter` just records the send in DB.
 */

export type SmsSendResult = {
  providerId: string;
};

export interface SmsAdapter {
  readonly name: "log-only" | "eskiz" | "playmobile" | string;
  send(to: string, body: string): Promise<SmsSendResult>;
}
