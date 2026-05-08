/**
 * POST /api/webhooks/billing/payme — Payme JSON-RPC webhook (LogOnly).
 *
 * Verification lives in `paymeVerifyWebhook`; the secret is read from
 * `PAYME_SECRET_KEY`. Missing secret in dev → stub-accept.
 *
 * On `PerformTransaction` we mark the invoice PAID. Other JSON-RPC
 * methods (CheckPerformTransaction / CreateTransaction / …) are
 * acknowledged but do not mutate state — those phases are part of the
 * full Payme handshake we punt to Wave 4.
 */
import { markInvoicePaid } from "@/server/billing/invoice";
import { paymeVerifyWebhook } from "@/server/billing/payments/payme";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32700, message: "InvalidJson" } },
      { status: 400 },
    );
  }

  const secret = process.env.PAYME_SECRET_KEY;
  const authHeader = request.headers.get("authorization");
  const result = await paymeVerifyWebhook(payload, secret, authHeader);
  if (!result.ok) {
    console.warn("[payme webhook] verify failed:", result.reason);
    return Response.json(
      {
        jsonrpc: "2.0",
        id: (payload as { id?: unknown })?.id ?? null,
        error: { code: -32504, message: result.reason },
      },
      { status: 400 },
    );
  }

  if (result.method === "PerformTransaction" && result.invoiceId) {
    try {
      await markInvoicePaid(
        result.invoiceId,
        result.providerRef ?? `payme-${Date.now()}`,
      );
    } catch (err) {
      console.error("[payme webhook] markInvoicePaid threw:", err);
      return Response.json(
        {
          jsonrpc: "2.0",
          id: (payload as { id?: unknown })?.id ?? null,
          error: { code: -31008, message: "MarkPaidFailed" },
        },
        { status: 500 },
      );
    }
  }

  return Response.json({
    jsonrpc: "2.0",
    id: (payload as { id?: unknown })?.id ?? null,
    result: {
      ok: true,
      stub: result.stub === true,
      method: result.method ?? null,
    },
  });
}
