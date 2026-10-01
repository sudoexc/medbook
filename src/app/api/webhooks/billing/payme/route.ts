/**
 * POST /api/webhooks/billing/payme — Payme Merchant API endpoint.
 *
 * Not connected (audit AN-13, `online-payments.ts`). The old handler
 * answered every method with `{result:{ok:true}}`, which no Payme method
 * accepts, and could only mark an invoice paid if PerformTransaction carried
 * `params.account`, which Payme never sends there. Implementing the Merchant
 * API needs stored transactions and merchant credentials we do not have, so
 * the endpoint now says plainly that it is not connected, in the shape Payme
 * reads (JSON-RPC error, HTTP 200, a message per language), and never marks
 * an invoice paid. The pay page does not send anyone to Payme meanwhile.
 *
 * The Authorization check still runs when `PAYME_SECRET_KEY` is set, so the
 * log tells an authentic Payme call from a forged one.
 */
import { paymeVerifyWebhook } from "@/server/billing/payments/payme";

export const runtime = "nodejs";

type RpcId = string | number | null;

const NOT_CONNECTED = {
  ru: "Приём оплат через Payme не подключён",
  uz: "Payme orqali to'lov qabul qilish ulanmagan",
  en: "Payme payments are not connected",
};

/** Payme reads errors from HTTP 200 JSON-RPC envelopes only. */
function rpcError(id: RpcId, code: number, message: typeof NOT_CONNECTED | string) {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcError(null, -32700, "InvalidJson");
  }
  const rawId = (payload as { id?: unknown } | null)?.id;
  const id: RpcId =
    typeof rawId === "string" || typeof rawId === "number" ? rawId : null;

  const result = await paymeVerifyWebhook(
    payload,
    process.env.PAYME_SECRET_KEY,
    request.headers.get("authorization"),
  );
  if (!result.ok) {
    console.warn("[payme webhook] refused:", result.reason);
    // -32504: insufficient privileges, Payme's code for a failed auth check.
    return rpcError(id, -32504, NOT_CONNECTED);
  }

  console.warn(
    `[payme webhook] authentic ${result.method ?? "?"} for invoice=${result.invoiceId ?? "?"}, ` +
      "but the Merchant API is not implemented: answered not connected",
  );
  // -32400: system error. Payme cancels the payment on its side.
  return rpcError(id, -32400, NOT_CONNECTED);
}
