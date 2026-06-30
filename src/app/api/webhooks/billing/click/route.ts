/**
 * POST /api/webhooks/billing/click — Click webhook receiver (LogOnly).
 *
 * Verification lives in `clickVerifyWebhook`; the secret is read from
 * `CLICK_SECRET_KEY`. Missing secret in dev → stub-accept; in prod a
 * real merchant configuration MUST set the env var.
 *
 * On `ok: true` and `action === 1` (Click's "complete" notification),
 * we mark the invoice PAID via `markInvoicePaid`. For `action === 0`
 * (prepare) we just log — the prepare/complete protocol with click is
 * beyond the Wave 3 stub.
 */
import { markInvoicePaid } from "@/server/billing/invoice";
import { clickVerifyWebhook } from "@/server/billing/payments/click";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: -32700, error_note: "InvalidJson" },
      { status: 400 },
    );
  }

  const secret = process.env.CLICK_SECRET_KEY;
  // Fail closed in production: without the shared secret the verifier degrades
  // to stub-accept, which would let anyone POST a forged "complete" and mark
  // invoices PAID for free. Dev/staging keep the stub so simulate-pay works.
  if (!secret && process.env.NODE_ENV === "production") {
    console.error("[click webhook] CLICK_SECRET_KEY unset in production — refusing");
    return Response.json(
      { error: -1, error_note: "WebhookNotConfigured" },
      { status: 503 },
    );
  }
  const result = await clickVerifyWebhook(payload, secret);
  if (!result.ok) {
    console.warn("[click webhook] verify failed:", result.reason);
    return Response.json(
      { error: -1, error_note: result.reason },
      { status: 400 },
    );
  }

  // Action coercion — Click sends a string or number depending on the
  // documented endpoint version. Treat "1" / 1 as "complete".
  const action = (payload as Record<string, unknown>).action;
  const isComplete = String(action) === "1";

  if (isComplete && result.invoiceId) {
    try {
      await markInvoicePaid(
        result.invoiceId,
        result.providerRef ?? `click-${Date.now()}`,
        { expectedAmountTiins: result.amountTiins },
      );
    } catch (err) {
      console.error("[click webhook] markInvoicePaid threw:", err);
      return Response.json(
        { error: -2, error_note: "MarkPaidFailed" },
        { status: 500 },
      );
    }
  }

  return Response.json({ error: 0, error_note: "OK", stub: result.stub === true });
}
