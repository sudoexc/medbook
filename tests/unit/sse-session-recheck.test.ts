import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit SEC-05 — the CRM event stream (/api/events) stays open up to an hour
 * and used to keep streaming patient chat and queue events to an employee
 * who had been deactivated in the meantime. It now re-checks the session
 * every minute and closes; the browser's reconnect then gets 401.
 *
 * Also: the watcher that sends a browser to /login once its session is gone
 * only reacts to our own staff APIs.
 */

const h = vi.hoisted(() => ({
  evaluate: vi.fn(),
  unsubscribed: 0,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: "RECEPTIONIST", clinicId: "c1", sessionId: "s1" },
  })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/server/auth/session-guard", () => ({ evaluateStaffSession: h.evaluate }));
vi.mock("@/server/realtime/event-bus", () => ({
  getEventBus: () => ({
    subscribe: () => () => {
      h.unsubscribed++;
    },
  }),
}));
vi.mock("@/server/realtime/redis-adapter", () => ({
  isRedisEnabled: () => false,
  ensureRedisSubscriber: () => {},
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/events/route";
import { isSessionScopedApi } from "@/components/auth/session-expiry-watch";

beforeEach(() => {
  vi.useFakeTimers();
  h.evaluate.mockReset();
  h.unsubscribed = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunks: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return { chunks, done: true };
    chunks.push(new TextDecoder().decode(value));
    if (chunks.length > 50) return { chunks, done: false };
  }
}

describe("/api/events re-checks the session while open", () => {
  it("closes the stream once the session is no longer valid", async () => {
    h.evaluate.mockResolvedValueOnce({ ok: true, sessionId: "s1", fresh: null });
    h.evaluate.mockResolvedValue({ ok: false, reason: "inactive", sessionId: "s1" });

    const res = await GET(new NextRequest("https://neurofax.uz/api/events"));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(": ok");

    // Minute one: still fine. Minute two: deactivated → stream ends.
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const { done } = await drain(reader);
    expect(done).toBe(true);
    expect(h.unsubscribed).toBe(1);

    // Re-checks name the JWT's session and do not count as user activity.
    expect(h.evaluate).toHaveBeenCalledWith({
      claims: { userId: "u1", role: "RECEPTIONIST", clinicId: "c1" },
      binding: { kind: "sid", sessionId: "s1" },
      countAsActivity: false,
    });
  });
});

describe("isSessionScopedApi", () => {
  const origin = "https://neurofax.uz";
  it("watches our staff APIs", () => {
    expect(isSessionScopedApi("/api/crm/patients", origin)).toBe(true);
    expect(isSessionScopedApi("https://neurofax.uz/api/crm/doctors/me/today", origin)).toBe(true);
  });
  it("ignores NextAuth, the login pre-flight, patient-facing and foreign URLs", () => {
    expect(isSessionScopedApi("/api/auth/session", origin)).toBe(false);
    expect(isSessionScopedApi("/api/crm/auth/totp-required", origin)).toBe(false);
    expect(isSessionScopedApi("/api/miniapp/me", origin)).toBe(false);
    expect(isSessionScopedApi("/api/c/neurofax/queue/checkin", origin)).toBe(false);
    expect(isSessionScopedApi("https://evil.example/api/crm/x", origin)).toBe(false);
    expect(isSessionScopedApi("/crm/patients", origin)).toBe(false);
  });
});
