/**
 * Click payment adapter.
 *
 * Two responsibilities:
 *
 *   1. `clickCreateCharge` — build the user-facing checkout URL the
 *      browser should navigate to. If the merchant credentials are
 *      configured (`CLICK_SERVICE_ID` + `CLICK_MERCHANT_ID`) we return
 *      Click's real `my.click.uz/services/pay` URL. Otherwise we fall
 *      back to the in-app stub page so QA can drive the flow without
 *      provisioning provider credentials.
 *
 *   2. `clickVerifyWebhook` — verify the inbound webhook against the
 *      MD5 sign-string Click documents:
 *
 *        md5(click_trans_id + service_id + SECRET_KEY +
 *            merchant_trans_id + amount + action + sign_time)
 *
 *      When `CLICK_SECRET_KEY` is unset (dev), the webhook stub-accepts
 *      so the simulate-pay button still works end-to-end. In prod the
 *      env var MUST be set; the route handler decides whether to act.
 *
 *  The `secretFromEnv` argument is NOT read from `process.env` here —
 *  the route handler reads it and passes it in. That keeps this module
 *  pure-ish (testable without env mutation).
 */
import { createHash } from "node:crypto";

export interface ClickWebhookPayload {
  /** Provided by Click. We use it to look up the Invoice. */
  merchant_trans_id: string;
  /** Decimal soum, e.g. "120000.00". */
  amount: string;
  /** 0 = prepare, 1 = complete. We log both, mark PAID on action=1. */
  action: string | number;
  /** MD5 hex digest. */
  sign_string: string;
  /** Click-side ids carried back to the caller for support tickets. */
  click_trans_id?: string | number;
  service_id?: string | number;
  sign_time?: string;
  // Click sends a fixed schema — we accept the well-known fields and
  // ignore the rest so a forward-compatible field addition (e.g.
  // merchant_prepare_id) doesn't break verification.
  [key: string]: unknown;
}

export interface ClickCreateChargeInput {
  invoice: { id: string; number: string; amountTiins: bigint };
  /** Absolute URL Click redirects the user back to after payment. */
  returnUrl: string;
  /** UI locale; threaded through to the stub fallback URL. */
  locale?: "ru" | "uz";
}

export interface ClickCreateChargeResult {
  payUrl: string;
  providerRef: string;
  /** True when credentials are missing and we fell back to the in-app stub. */
  isStub: boolean;
}

export interface ClickVerifyOk {
  ok: true;
  invoiceId?: string;
  providerRef?: string;
  /** Charged amount in tiins, parsed from the webhook's decimal-soum field. */
  amountTiins?: bigint;
  /** Set when the verification ran in stub mode (no secret in env). */
  stub?: boolean;
}

export interface ClickVerifyFail {
  ok: false;
  reason: string;
}

export type ClickVerifyResult = ClickVerifyOk | ClickVerifyFail;

/**
 * Build the user-facing Click checkout URL.
 *
 * Real mode (credentials present) produces e.g.
 *   https://my.click.uz/services/pay
 *     ?service_id=...&merchant_id=...
 *     &amount=120000.00
 *     &transaction_param=<invoice_id>
 *     &return_url=<urlencoded return URL>
 *
 * Stub mode (credentials missing) keeps the legacy in-app URL pointing
 * at the simulate-pay screen so the flow still demoable in dev.
 */
export async function clickCreateCharge(
  input: ClickCreateChargeInput,
  env: {
    serviceId?: string;
    merchantId?: string;
  } = {},
): Promise<ClickCreateChargeResult> {
  const { invoice, returnUrl } = input;
  const locale = input.locale ?? "ru";
  const serviceId = env.serviceId ?? process.env.CLICK_SERVICE_ID;
  const merchantId = env.merchantId ?? process.env.CLICK_MERCHANT_ID;

  if (!serviceId || !merchantId) {
    console.info(
      `[click] stub createCharge invoice=${invoice.id} number=${invoice.number} ` +
        `(missing CLICK_SERVICE_ID or CLICK_MERCHANT_ID)`,
    );
    return {
      payUrl: `/${locale}/crm/settings/billing/pay/${invoice.id}`,
      providerRef: `stub-click-${invoice.number}`,
      isStub: true,
    };
  }

  // Click wants decimal soum, not tiins. tiins / 100 with exact integer
  // math — invoices are seeded as whole-soum values, but if somebody
  // ever stores a sub-soum residue we render it as `.NN` rather than
  // silently floor.
  const amountSoum = tiinsToSoumString(invoice.amountTiins);

  const params = new URLSearchParams({
    service_id: serviceId,
    merchant_id: merchantId,
    amount: amountSoum,
    transaction_param: invoice.id,
    return_url: returnUrl,
  });
  const payUrl = `https://my.click.uz/services/pay?${params.toString()}`;
  return {
    payUrl,
    providerRef: `click-${invoice.number}`,
    isStub: false,
  };
}

function tiinsToSoumString(tiins: bigint): string {
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  const negative = tiins < ZERO;
  const abs = negative ? -tiins : tiins;
  const whole = abs / HUNDRED;
  const frac = abs % HUNDRED;
  const fracStr = frac.toString().padStart(2, "0");
  const sign = negative ? "-" : "";
  return frac === ZERO
    ? `${sign}${whole.toString()}`
    : `${sign}${whole.toString()}.${fracStr}`;
}

/**
 * Verify a Click webhook. Returns `{ok: true, stub: true}` when the
 * shared secret env var is missing — accepted in dev so the simulate
 * button works without provisioning real credentials. In prod the env
 * var MUST be set; otherwise the webhook silently degrades to stub.
 */
export async function clickVerifyWebhook(
  payload: unknown,
  secretFromEnv: string | undefined,
): Promise<ClickVerifyResult> {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "payload_not_object" };
  }
  const p = payload as Partial<ClickWebhookPayload>;
  if (typeof p.merchant_trans_id !== "string" || !p.merchant_trans_id) {
    return { ok: false, reason: "missing_merchant_trans_id" };
  }

  const providerRef =
    typeof p.click_trans_id === "string" || typeof p.click_trans_id === "number"
      ? String(p.click_trans_id)
      : undefined;
  const amountTiins = soumStringToTiins(p.amount);

  if (!secretFromEnv) {
    // Stub mode — log and accept. The route handler decides whether to
    // act on the result; in prod it fails closed when the secret is unset.
    console.info(
      `[click] webhook stub-accept invoice=${p.merchant_trans_id} action=${String(p.action)}`,
    );
    return {
      ok: true,
      stub: true,
      invoiceId: p.merchant_trans_id,
      providerRef,
      amountTiins,
    };
  }

  if (typeof p.sign_string !== "string" || !p.sign_string) {
    return { ok: false, reason: "missing_signature" };
  }

  const expected = computeClickSignature(p, secretFromEnv);
  if (expected !== p.sign_string.toLowerCase()) {
    return { ok: false, reason: "bad_signature" };
  }
  return {
    ok: true,
    invoiceId: p.merchant_trans_id,
    providerRef,
    amountTiins,
  };
}

/**
 * Parse Click's decimal-soum `amount` (e.g. "120000.00") into tiins. Returns
 * undefined for any non-numeric/malformed value so the caller can decide
 * whether a missing amount is fatal.
 */
function soumStringToTiins(amount: unknown): bigint | undefined {
  if (typeof amount !== "string" && typeof amount !== "number") return undefined;
  const s = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  return BigInt(whole) * BigInt(100) + BigInt(fracPadded || "0");
}

/**
 * Pure helper. Mirrors Click's documented signature recipe.
 * Returns the lowercase hex MD5.
 */
export function computeClickSignature(
  payload: Partial<ClickWebhookPayload>,
  secret: string,
): string {
  const concat = [
    payload.click_trans_id ?? "",
    payload.service_id ?? "",
    secret,
    payload.merchant_trans_id ?? "",
    payload.amount ?? "",
    payload.action ?? "",
    payload.sign_time ?? "",
  ]
    .map((v) => String(v))
    .join("");
  return createHash("md5").update(concat).digest("hex").toLowerCase();
}
