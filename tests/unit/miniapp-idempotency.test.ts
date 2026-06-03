/**
 * Phase M4 — `withIdempotency` middleware tests.
 *
 * Verify:
 *   • No header → handler runs every time, no caching.
 *   • Malformed header → handler still runs, no caching, no throw.
 *   • Valid header, first call → handler runs.
 *   • Valid header, second call → handler does NOT run, response replays.
 *   • Different scopes (different patient/clinic) do not collide.
 *   • 5xx responses are NOT cached.
 *   • 4xx responses ARE cached (deterministic validation outcomes replay).
 *
 * Redis is NOT exercised — REDIS_URL is unset for the suite, so the
 * in-memory fallback is the path under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetIdempotencyForTests,
  withIdempotency,
} from "@/server/miniapp/idempotency";

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("http://x.test/api/miniapp/appointments", {
    method: "POST",
    headers,
  });
}

describe("withIdempotency", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    __resetIdempotencyForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the handler every time when no header is present", async () => {
    const handler = vi.fn(async () =>
      Response.json({ id: "a" }, { status: 201 }),
    );
    const scope = { clinicId: "c1", patientId: "p1" };
    await withIdempotency(makeReq(), scope, handler);
    await withIdempotency(makeReq(), scope, handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("ignores a malformed header (too short) and still runs without caching", async () => {
    const handler = vi.fn(async () =>
      Response.json({ id: "a" }, { status: 201 }),
    );
    const scope = { clinicId: "c1", patientId: "p1" };
    await withIdempotency(makeReq({ "idempotency-key": "abc" }), scope, handler);
    await withIdempotency(makeReq({ "idempotency-key": "abc" }), scope, handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("replays the same response on a second call with the same key + scope", async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "first" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ id: "second" }, { status: 201 }));
    const scope = { clinicId: "c1", patientId: "p1" };
    const headers = { "idempotency-key": "01HZZZABCDEFGHJKLMNPQRST" };
    const r1 = await withIdempotency(makeReq(headers), scope, handler);
    const r2 = await withIdempotency(makeReq(headers), scope, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await r1.clone().json()).toEqual({ id: "first" });
    expect(await r2.clone().json()).toEqual({ id: "first" });
    expect(r2.headers.get("x-idempotent-replay")).toBe("1");
  });

  it("isolates the cache per (clinicId, patientId)", async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "a" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ id: "b" }, { status: 201 }));
    const headers = { "idempotency-key": "01HZZZABCDEFGHJKLMNPQRST" };
    await withIdempotency(
      makeReq(headers),
      { clinicId: "c1", patientId: "p1" },
      handler,
    );
    await withIdempotency(
      makeReq(headers),
      { clinicId: "c1", patientId: "p2" },
      handler,
    );
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not cache 5xx responses (transient failures must be retriable)", async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "boom" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: "ok" }, { status: 201 }));
    const scope = { clinicId: "c1", patientId: "p1" };
    const headers = { "idempotency-key": "01HZZZABCDEFGHJKLMNPQRST" };
    const r1 = await withIdempotency(makeReq(headers), scope, handler);
    expect(r1.status).toBe(503);
    const r2 = await withIdempotency(makeReq(headers), scope, handler);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(r2.status).toBe(201);
    expect(await r2.clone().json()).toEqual({ id: "ok" });
  });

  it("caches 4xx responses (deterministic outcomes should replay identically)", async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ reason: "doctor_busy" }, { status: 409 }),
      )
      .mockResolvedValueOnce(
        Response.json({ reason: "different" }, { status: 409 }),
      );
    const scope = { clinicId: "c1", patientId: "p1" };
    const headers = { "idempotency-key": "01HZZZABCDEFGHJKLMNPQRST" };
    const r1 = await withIdempotency(makeReq(headers), scope, handler);
    const r2 = await withIdempotency(makeReq(headers), scope, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(r1.status).toBe(409);
    expect(r2.status).toBe(409);
    expect(await r2.clone().json()).toEqual({ reason: "doctor_busy" });
  });
});
