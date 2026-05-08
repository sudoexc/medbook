/**
 * Phase 19 Wave 3 — Payme payment adapter (LogOnly stub).
 *
 * Payme uses JSON-RPC (CheckPerformTransaction / CreateTransaction /
 * PerformTransaction). Authentication is HTTP-Basic with the Payme
 * subscribe key. For Wave 3 we accept any well-formed JSON-RPC envelope
 * and log the parsed call. Real Payme integration is post-MVP.
 *
 * The shared secret here is the Payme `Authorization: Basic ...` value
 * the merchant configures in their dashboard. The route reads it from
 * env and threads it in.
 */

export interface PaymeRpcEnvelope {
  jsonrpc?: "2.0" | string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface PaymeCreateChargeResult {
  payUrl: string;
  providerRef: string;
}

export interface PaymeVerifyOk {
  ok: true;
  invoiceId?: string;
  providerRef?: string;
  method?: string;
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

export async function paymeCreateCharge(
  invoice: { id: string; number: string },
  locale: "ru" | "uz" = "ru",
): Promise<PaymeCreateChargeResult> {
  console.info(
    `[payme] stub createCharge invoice=${invoice.id} number=${invoice.number}`,
  );
  return {
    payUrl: `/${locale}/crm/settings/billing/pay/${invoice.id}`,
    providerRef: `stub-payme-${invoice.number}`,
  };
}

/**
 * Verify a Payme webhook envelope.
 *
 * Returns `{ok: true, stub: true}` when no shared secret is configured
 * — same dev-friendly fallback as the Click adapter. In prod the
 * Authorization header check would belong here too; we keep the seam
 * (the secret arg) so Wave 4 / real-integration can drop it in.
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

  if (!secretFromEnv) {
    console.info(
      `[payme] webhook stub-accept method=${env.method} invoice=${String(invoiceId)}`,
    );
    return {
      ok: true,
      stub: true,
      method: env.method,
      invoiceId: typeof invoiceId === "string" ? invoiceId : undefined,
      providerRef: typeof env.id === "string" || typeof env.id === "number"
        ? String(env.id)
        : undefined,
    };
  }

  // Real impl checks `authHeader` against `Basic ${b64(`Paycom:${secret}`)}`.
  // Wave 3 stub: require the header to be present and start with "Basic ".
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
    providerRef:
      typeof env.id === "string" || typeof env.id === "number"
        ? String(env.id)
        : undefined,
  };
}
