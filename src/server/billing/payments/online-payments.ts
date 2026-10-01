/**
 * Whether a clinic can pay a subscription invoice online (audit AN-13).
 *
 * Not yet, with either provider. Completing a payment needs each
 * provider's merchant protocol: Payme's Merchant API (CheckPerformTransaction,
 * CreateTransaction, PerformTransaction, CancelTransaction, CheckTransaction
 * against stored transactions) and Click's Prepare/Complete with a
 * `merchant_prepare_id` we issue and check. Neither is implemented, and
 * neither can be tested without the merchant credentials the platform does
 * not have. Until then:
 *   - the pay page says online payment is not connected and offers the PDF
 *     invoice instead of buttons that lead to a provider error;
 *   - POST /api/crm/billing/invoices/[id]/charge refuses (503);
 *   - the webhooks answer every call with the provider's own error format
 *     and never mark an invoice paid.
 * Flip a provider to `true` only together with its full protocol.
 */
export type OnlineProvider = "click" | "payme";

const CONNECTED: Record<OnlineProvider, boolean> = {
  click: false,
  payme: false,
};

export function isOnlinePaymentConnected(provider: OnlineProvider): boolean {
  return CONNECTED[provider];
}

export function anyOnlinePaymentConnected(): boolean {
  return CONNECTED.click || CONNECTED.payme;
}
