/**
 * Payme payment adapter.
 *
 * Two responsibilities:
 *
 *   1. `paymeCreateCharge` — build the user-facing checkout URL the
 *      browser should navigate to. If `PAYME_MERCHANT_ID` is configured
 *      we return Payme's real `checkout.paycom.uz/<base64(params)>` URL.
 *      Otherwise we fall back to the in-app stub page so QA can drive
 *      the flow without provisioning provider credentials.
 *
 *   2. `paymeVerifyWebhook` — accept a Payme JSON-RPC envelope and
 *      verify the `Authorization: Basic ${b64('Paycom:'+SECRET)}` header
 *      Payme sends with every notification.
 *
 *  The shared secret here is the Payme `Authorization: Basic …` value
 *  the merchant configures in their dashboard. The route reads it from
 *  env and threads it in.
 */

export interface PaymeRpcEnvelope {
  jsonrpc?: "2.0" | string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface PaymeCreateChargeInput {
  invoice: { id: string; number: string; amountTiins: bigint };
  /** Absolute URL Payme redirects the user back to after payment. */
  returnUrl: string;
  /** UI locale — both for the stub fallback and the `l=` checkout param. */
  locale?: "ru" | "uz";
}

export interface PaymeCreateChargeResult {
  payUrl: string;
  providerRef: string;
  /** True when credentials are missing and we fell back to the in-app stub. */
  isStub: boolean;
}

export interface PaymeVerifyOk {
  ok: true;
  invoiceId?: string;
  providerRef?: string;
  method?: string;
  /** Charged amount in tiins, parsed from the JSON-RPC `params.amount`. */
  amountTiins?: bigint;
  stub?: boolean;
}

export interface PaymeVerifyFail {
  ok: false;
  reason: string;
}

export type PaymeVerifyResult = PaymeVerifyOk | PaymeVerifyFail;

const PAYME_METHODS = new Set([
  "CheckPerformTransaction",
  "CreateTransaction",
  "PerformTransaction",
  "CancelTransaction",
  "CheckTransaction",
  "GetStatement",
]);

/**
 * Build the user-facing Payme checkout URL.
 *
 * Payme encodes its checkout params as base64 of a semicolon-separated
 * `key=value` string, then appends them as the path:
 *
 *   https://checkout.paycom.uz/<base64("m=...;ac.invoice_id=...;a=<tiins>;l=ru;c=<return>")>
 *
 * `ac.invoice_id` is the merchant-account field name Payme expects —
 * it's configured in the merchant cabinet and MUST match what the
 * webhook later sends inside `params.account`.
 */
export async function paymeCreateCharge(
  input: PaymeCreateChargeInput,
  env: { merchantId?: string } = {},
): Promise<PaymeCreateChargeResult> {
  const { invoice, returnUrl } = input;
  const locale = input.locale ?? "ru";
  const merchantId = env.merchantId ?? process.env.PAYME_MERCHANT_ID;

  if (!merchantId) {
    console.info(
      `[payme] stub createCharge invoice=${invoice.id} number=${invoice.number} ` +
        `(missing PAYME_MERCHANT_ID)`,
    );
    return {
      payUrl: `/${locale}/crm/settings/billing/pay/${invoice.id}`,
      providerRef: `stub-payme-${invoice.number}`,
      isStub: true,
    };
  }

  // Payme expects the amount in tiins (smallest unit) as an integer.
  const amountTiins = invoice.amountTiins.toString();
  const semi = [
    `m=${merchantId}`,
    `ac.invoice_id=${invoice.id}`,
    `a=${amountTiins}`,
    `l=${locale}`,
    `c=${returnUrl}`,
  ].join(";");
  const encoded = Buffer.from(semi, "utf8").toString("base64");
  const payUrl = `https://checkout.paycom.uz/${encoded}`;
  return {
    payUrl,
    providerRef: `payme-${invoice.number}`,
    isStub: false,
  };
}

/**
 * Verify a Payme webhook envelope.
 *
 * Returns `{ok: true, stub: true}` when no shared secret is configured
 * — same dev-friendly fallback as the Click adapter. In prod the
 * Authorization header check enforces `Basic ${b64('Paycom:'+SECRET)}`.
 */
export async function paymeVerifyWebhook(
  payload: unknown,
  secretFromEnv: string | undefined,
  authHeader?: string | null,
): Promise<PaymeVerifyResult> {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "payload_not_object" };
  }
  const env = payload as PaymeRpcEnvelope;
  if (env.jsonrpc !== "2.0") {
    return { ok: false, reason: "bad_jsonrpc" };
  }
  if (typeof env.method !== "string" || !PAYME_METHODS.has(env.method)) {
    return { ok: false, reason: "unknown_method" };
  }

  const params = env.params ?? {};
  const account =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>).account
      : undefined;
  const invoiceId =
    account && typeof account === "object"
      ? (account as Record<string, unknown>).invoice_id ??
        (account as Record<string, unknown>).order_id ??
        undefined
      : undefined;

  const rawAmount = (params as Record<string, unknown>).amount;
  const amountTiins =
    typeof rawAmount === "number" && Number.isFinite(rawAmount)
      ? BigInt(Math.round(rawAmount))
      : typeof rawAmount === "string" && /^\d+$/.test(rawAmount)
        ? BigInt(rawAmount)
        : undefined;
  const providerRef =
    typeof env.id === "string" || typeof env.id === "number"
      ? String(env.id)
      : undefined;

  if (!secretFromEnv) {
    console.info(
      `[payme] webhook stub-accept method=${env.method} invoice=${String(invoiceId)}`,
    );
    return {
      ok: true,
      stub: true,
      method: env.method,
      invoiceId: typeof invoiceId === "string" ? invoiceId : undefined,
      providerRef,
      amountTiins,
    };
  }

  if (!authHeader || !authHeader.toLowerCase().startsWith("basic ")) {
    return { ok: false, reason: "missing_auth_header" };
  }
  const expected =
    "Basic " + Buffer.from(`Paycom:${secretFromEnv}`).toString("base64");
  if (authHeader !== expected) {
    return { ok: false, reason: "bad_signature" };
  }

  return {
    ok: true,
    method: env.method,
    invoiceId: typeof invoiceId === "string" ? invoiceId : undefined,
    providerRef,
    amountTiins,
  };
}
