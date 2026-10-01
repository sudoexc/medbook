/**
 * POST /api/webhooks/billing/click — Click SHOP-API endpoint (Prepare /
 * Complete).
 *
 * Not connected (audit AN-13, `online-payments.ts`). The old handler read
 * the body as JSON while Click posts `application/x-www-form-urlencoded`,
 * signed the Complete call without `merchant_prepare_id`, answered without
 * `merchant_prepare_id` / `merchant_confirm_id`, and stub-accepted unsigned
 * calls outside production. Prepare/Complete needs a prepare id we issue and
 * check plus merchant credentials we do not have, so the endpoint now reads
 * Click's form body, answers in Click's response shape with an error, and
 * never marks an invoice paid. The pay page does not send anyone to Click
 * meanwhile.
 *
 * The signature check still runs when `CLICK_SECRET_KEY` is set, so the log
 * tells an authentic Click call from a forged one.
 */
import {
  clickVerifyWebhook,
  readClickBody,
} from "@/server/billing/payments/click";

export const runtime = "nodejs";

/** Click's error codes: -1 sign check failed, -8 error in request. */
const SIGN_CHECK_FAILED = -1;
const NOT_CONNECTED = -8;

export async function POST(request: Request): Promise<Response> {
  const payload = await readClickBody(request);
  if (!payload) {
    return Response.json(
      { error: NOT_CONNECTED, error_note: "Bad request" },
      { status: 200 },
    );
  }
  const echo = {
    click_trans_id: payload.click_trans_id ?? null,
    merchant_trans_id: payload.merchant_trans_id ?? null,
  };

  const result = await clickVerifyWebhook(payload, process.env.CLICK_SECRET_KEY);
  if (!result.ok) {
    console.warn("[click webhook] refused:", result.reason);
    return Response.json(
      {
        ...echo,
        error: result.reason === "not_configured" ? NOT_CONNECTED : SIGN_CHECK_FAILED,
        error_note:
          result.reason === "not_configured"
            ? "Click payments are not connected"
            : "SIGN CHECK FAILED",
      },
      { status: 200 },
    );
  }

  console.warn(
    `[click webhook] authentic action=${String(payload.action)} for invoice=${result.invoiceId ?? "?"}, ` +
      "but Prepare/Complete is not implemented: answered not connected",
  );
  // An error at Prepare makes Click cancel the payment on its side.
  return Response.json(
    { ...echo, error: NOT_CONNECTED, error_note: "Click payments are not connected" },
    { status: 200 },
  );
}
