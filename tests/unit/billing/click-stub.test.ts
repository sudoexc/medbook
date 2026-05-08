/**
 * Phase 19 Wave 3 — Click webhook verifier (stub mode).
 *
 *   - Missing secret → `{ ok: true, stub: true }`.
 *   - Invalid signature → `{ ok: false, reason: "bad_signature" }`.
 *   - Valid signature → `{ ok: true }` with parsed invoiceId.
 *   - Malformed envelope → `{ ok: false, reason: ... }`.
 */
import { describe, expect, it } from "vitest";
import {
  clickVerifyWebhook,
  computeClickSignature,
  clickCreateCharge,
} from "@/server/billing/payments/click";

const SECRET = "super-secret-click-key";

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    click_trans_id: 100,
    service_id: 200,
    merchant_trans_id: "inv-abc",
    amount: "120000.00",
    action: 1,
    sign_time: "2026-05-07 12:00:00",
    ...overrides,
  };
}

describe("clickVerifyWebhook", () => {
  it("accepts in stub mode when secret env is missing", async () => {
    const payload = buildPayload({ sign_string: "ignored" });
    const res = await clickVerifyWebhook(payload, undefined);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stub).toBe(true);
      expect(res.invoiceId).toBe("inv-abc");
    }
  });

  it("rejects when secret is set but signature is wrong", async () => {
    const payload = buildPayload({ sign_string: "deadbeef" });
    const res = await clickVerifyWebhook(payload, SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_signature");
  });

  it("accepts a correctly signed payload", async () => {
    const base = buildPayload();
    const sig = computeClickSignature(base, SECRET);
    const payload = { ...base, sign_string: sig };
    const res = await clickVerifyWebhook(payload, SECRET);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stub).toBeUndefined();
      expect(res.invoiceId).toBe("inv-abc");
      expect(res.providerRef).toBe("100");
    }
  });

  it("is case-insensitive on the signature compare", async () => {
    const base = buildPayload();
    const sig = computeClickSignature(base, SECRET).toUpperCase();
    const payload = { ...base, sign_string: sig };
    const res = await clickVerifyWebhook(payload, SECRET);
    expect(res.ok).toBe(true);
  });

  it("rejects payloads missing merchant_trans_id", async () => {
    const res = await clickVerifyWebhook(
      { amount: "10", action: 1 },
      undefined,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("missing_merchant_trans_id");
  });

  it("rejects non-object payloads", async () => {
    const res = await clickVerifyWebhook("not-an-object", SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("payload_not_object");
  });

  it("rejects when secret set but signature is missing", async () => {
    const payload = buildPayload();
    delete (payload as Record<string, unknown>).sign_string;
    const res = await clickVerifyWebhook(payload, SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("missing_signature");
  });
});

describe("clickCreateCharge", () => {
  it("returns a stub pay URL pointing at the simulate page", async () => {
    const res = await clickCreateCharge(
      { id: "inv-1", number: "INV-2026-0001" },
      "uz",
    );
    expect(res.payUrl).toBe("/uz/crm/settings/billing/pay/inv-1");
    expect(res.providerRef).toContain("INV-2026-0001");
  });

  it("defaults to RU when locale is not provided", async () => {
    const res = await clickCreateCharge({ id: "inv-2", number: "X" });
    expect(res.payUrl).toBe("/ru/crm/settings/billing/pay/inv-2");
  });
});
