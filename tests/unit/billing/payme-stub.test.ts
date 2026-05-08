/**
 * Phase 19 Wave 3 — Payme JSON-RPC webhook verifier (stub mode).
 */
import { describe, expect, it } from "vitest";
import {
  paymeVerifyWebhook,
  paymeCreateCharge,
} from "@/server/billing/payments/payme";

const SECRET = "super-secret-payme-key";
const GOOD_AUTH = "Basic " + Buffer.from(`Paycom:${SECRET}`).toString("base64");

function envelope(method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id: 42,
    method,
    params,
  };
}

describe("paymeVerifyWebhook", () => {
  it("accepts in stub mode when secret is missing", async () => {
    const env = envelope("CreateTransaction", {
      account: { invoice_id: "inv-x" },
    });
    const res = await paymeVerifyWebhook(env, undefined, null);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stub).toBe(true);
      expect(res.invoiceId).toBe("inv-x");
      expect(res.method).toBe("CreateTransaction");
      expect(res.providerRef).toBe("42");
    }
  });

  it("rejects bad jsonrpc envelope", async () => {
    const res = await paymeVerifyWebhook(
      { jsonrpc: "1.0", method: "CreateTransaction", id: 1 },
      undefined,
      null,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_jsonrpc");
  });

  it("rejects unknown methods", async () => {
    const res = await paymeVerifyWebhook(
      envelope("DropTablesPlease"),
      undefined,
      null,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("unknown_method");
  });

  it("rejects missing auth header when secret is set", async () => {
    const res = await paymeVerifyWebhook(
      envelope("CreateTransaction"),
      SECRET,
      null,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("missing_auth_header");
  });

  it("rejects mis-signed auth header", async () => {
    const res = await paymeVerifyWebhook(
      envelope("CreateTransaction"),
      SECRET,
      "Basic deadbeef",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_signature");
  });

  it("accepts a correctly signed envelope", async () => {
    const env = envelope("PerformTransaction", {
      account: { invoice_id: "inv-pay" },
    });
    const res = await paymeVerifyWebhook(env, SECRET, GOOD_AUTH);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.method).toBe("PerformTransaction");
      expect(res.invoiceId).toBe("inv-pay");
      expect(res.stub).toBeUndefined();
    }
  });

  it("rejects non-object payloads", async () => {
    const res = await paymeVerifyWebhook(null, SECRET, GOOD_AUTH);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("payload_not_object");
  });
});

describe("paymeCreateCharge", () => {
  it("returns a stub pay URL", async () => {
    const res = await paymeCreateCharge(
      { id: "inv-1", number: "INV-2026-0001" },
      "ru",
    );
    expect(res.payUrl).toBe("/ru/crm/settings/billing/pay/inv-1");
    expect(res.providerRef).toContain("INV-2026-0001");
  });
});
