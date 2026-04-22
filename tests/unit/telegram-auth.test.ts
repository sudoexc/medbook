/**
 * Tests for Telegram auth verifiers (`src/server/telegram/auth.ts`).
 *
 * We construct valid signed payloads in-test, so we know the expected hash
 * matches; we also flip a bit to confirm the negative paths.
 */
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  verifyLoginWidget,
  verifyMiniAppInitData,
} from "@/server/telegram/auth";

const TOKEN = "123456:test-bot-token";

function signLoginWidget(payload: Record<string, string | number>): {
  data: Record<string, string | number>;
  hash: string;
} {
  // data-check-string = sorted key=value joined by \n, excluding hash.
  const entries = Object.entries(payload)
    .filter(([k]) => k !== "hash")
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHash("sha256").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return { data: { ...payload, hash }, hash };
}

function signInitData(fields: Record<string, string>): string {
  // Sort without `hash`, HMAC-sign with HMAC(WebAppData, token), return
  // URL-encoded query string.
  const entries = Object.entries(fields)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.append(k, v);
  params.append("hash", hash);
  return params.toString();
}

describe("verifyLoginWidget", () => {
  const now = Math.floor(Date.now() / 1000);

  it("accepts a properly signed payload", () => {
    const { data } = signLoginWidget({
      id: 1234,
      first_name: "Ivan",
      username: "ivan",
      auth_date: now,
    });
    const res = verifyLoginWidget(data, TOKEN);
    expect(res.ok).toBe(true);
  });

  it("rejects when hash is wrong", () => {
    const { data } = signLoginWidget({
      id: 1,
      auth_date: now,
    });
    const bad = { ...data, hash: "0".repeat(64) };
    const res = verifyLoginWidget(bad, TOKEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_hash");
  });

  it("rejects when a field is tampered after signing", () => {
    const { data } = signLoginWidget({
      id: 1,
      first_name: "Original",
      auth_date: now,
    });
    const tampered = { ...data, first_name: "Mallory" };
    const res = verifyLoginWidget(tampered, TOKEN);
    expect(res.ok).toBe(false);
  });

  it("rejects stale payloads", () => {
    const { data } = signLoginWidget({
      id: 1,
      auth_date: now - 2 * 86400,
    });
    const res = verifyLoginWidget(data, TOKEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("stale");
  });

  it("accepts stale payload with maxAgeSec=0", () => {
    const { data } = signLoginWidget({
      id: 1,
      auth_date: now - 2 * 86400,
    });
    const res = verifyLoginWidget(data, TOKEN, 0);
    expect(res.ok).toBe(true);
  });

  it("rejects missing hash field", () => {
    const res = verifyLoginWidget(
      { id: 1, auth_date: now } as Record<string, unknown>,
      TOKEN,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("missing_hash");
  });

  it("rejects missing token", () => {
    const res = verifyLoginWidget({ id: 1, auth_date: now, hash: "x" }, "");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("missing_token");
  });
});

describe("verifyMiniAppInitData", () => {
  const now = Math.floor(Date.now() / 1000);

  it("accepts a properly signed initData string", () => {
    const initData = signInitData({
      query_id: "abc",
      user: JSON.stringify({ id: 42, first_name: "Ivan", username: "ivan" }),
      auth_date: String(now),
    });
    const res = verifyMiniAppInitData(initData, TOKEN);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.user?.id).toBe(42);
      expect(res.data.query_id).toBe("abc");
    }
  });

  it("rejects when hash is forged", () => {
    const initData = signInitData({
      query_id: "abc",
      user: JSON.stringify({ id: 42 }),
      auth_date: String(now),
    });
    const broken = initData.replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64));
    const res = verifyMiniAppInitData(broken, TOKEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_hash");
  });

  it("rejects when a field is tampered", () => {
    const initData = signInitData({
      user: JSON.stringify({ id: 42 }),
      auth_date: String(now),
    });
    // Swap user payload but keep hash.
    const mutated = initData.replace(
      encodeURIComponent(JSON.stringify({ id: 42 })),
      encodeURIComponent(JSON.stringify({ id: 999 })),
    );
    const res = verifyMiniAppInitData(mutated, TOKEN);
    expect(res.ok).toBe(false);
  });

  it("rejects stale initData", () => {
    const initData = signInitData({
      user: JSON.stringify({ id: 1 }),
      auth_date: String(now - 2 * 86400),
    });
    const res = verifyMiniAppInitData(initData, TOKEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("stale");
  });

  it("rejects empty input", () => {
    const res = verifyMiniAppInitData("", TOKEN);
    expect(res.ok).toBe(false);
  });

  it("rejects missing hash in query string", () => {
    const params = new URLSearchParams({ auth_date: String(now) });
    const res = verifyMiniAppInitData(params.toString(), TOKEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("missing_hash");
  });
});
