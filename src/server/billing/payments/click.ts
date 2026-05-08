/**
 * Phase 19 Wave 3 — Click payment adapter (LogOnly stub).
 *
 * Click's official spec uses a `merchant_trans_id` field that maps to
 * our `Invoice.id`, plus an MD5 `sign_string` over a specific concat:
 *
 *   md5(click_trans_id + service_id + SECRET_KEY +
 *       merchant_trans_id + amount + action + sign_time)
 *
 * Wave 3 only verifies the shape and the signature — actually creating
 * a charge against Click is post-MVP. `clickCreateCharge` returns a
 * stub `payUrl` that points at the in-app simulate-pay screen so QA can
 * exercise the success path without leaving NeuroFax.
 *
 * The `secretFromEnv` argument is NOT read from `process.env` here —
 * the route handler reads it and passes it in. That keeps this module
 * pure-ish (testable without env mutation) and gives the caller the
 * choice of whether to allow stub mode.
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

export interface ClickCreateChargeResult {
  payUrl: string;
  providerRef: string;
}

export interface ClickVerifyOk {
  ok: true;
  invoiceId?: string;
  providerRef?: string;
  /** Set when the verification ran in stub mode (no secret in env). */
  stub?: boolean;
}

export interface ClickVerifyFail {
  ok: false;
  reason: string;
}

export type ClickVerifyResult = ClickVerifyOk | ClickVerifyFail;

/**
 * Stub charge creator. Real impl would call Click's REST endpoint to
 * register the merchant transaction. For Wave 3 we surface a pay-url
 * that points at the in-app simulate page.
 *
 * The `locale` is resolved upstream and threaded through so the URL
 * matches the user's current locale path segment.
 */
export async function clickCreateCharge(
  invoice: { id: string; number: string },
  locale: "ru" | "uz" = "ru",
): Promise<ClickCreateChargeResult> {
  console.info(
    `[click] stub createCharge invoice=${invoice.id} number=${invoice.number}`,
  );
  return {
    payUrl: `/${locale}/crm/settings/billing/pay/${invoice.id}`,
    providerRef: `stub-click-${invoice.number}`,
  };
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

  if (!secretFromEnv) {
    // Stub mode — log and accept. The route handler decides whether to
    // act on the result; in dev it does, in prod the route will not be
    // hit because real webhooks carry a signature.
    console.info(
      `[click] webhook stub-accept invoice=${p.merchant_trans_id} action=${String(p.action)}`,
    );
    return {
      ok: true,
      stub: true,
      invoiceId: p.merchant_trans_id,
      providerRef:
        typeof p.click_trans_id === "string" || typeof p.click_trans_id === "number"
          ? String(p.click_trans_id)
          : undefined,
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
    providerRef:
      typeof p.click_trans_id === "string" || typeof p.click_trans_id === "number"
        ? String(p.click_trans_id)
        : undefined,
  };
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
