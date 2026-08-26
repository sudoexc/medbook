/**
 * Mini App SSE reconnect policy.
 *
 * The bug this guards: `EventSource` stops retrying on its own after a fatal
 * handshake failure (401 when a 24h-old initData expires, 502 mid-deploy).
 * The old hook had no reconnect of its own, so the socket died permanently
 * and the patient stared at frozen data behind a pulsing "live" dot.
 */
import { describe, expect, it } from "vitest";

import {
  backoffDelayMs,
  shouldInvalidateOnForeground,
  shouldReviveOnForeground,
  shouldRetryAfterError,
} from "@/app/c/[slug]/my/_lib/live-reconnect";

// EventSource readyState constants (the spec values, not the DOM global —
// these tests run in a node environment).
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

describe("backoffDelayMs", () => {
  it("grows exponentially from 1s", () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(3)).toBe(8000);
  });

  it("caps at 30s so a long outage still retries twice a minute", () => {
    expect(backoffDelayMs(5)).toBe(30_000);
    expect(backoffDelayMs(50)).toBe(30_000);
  });

  it("never returns a negative or sub-second delay", () => {
    expect(backoffDelayMs(-1)).toBe(1000);
  });
});

describe("shouldRetryAfterError", () => {
  it("retries after a fatal error while still mounted", () => {
    // This is the whole fix: previously a CLOSED socket was never reopened.
    expect(shouldRetryAfterError(false)).toBe(true);
  });

  it("stops retrying once the subscription is disposed", () => {
    // Otherwise a pending backoff timer resurrects a socket after unmount.
    expect(shouldRetryAfterError(true)).toBe(false);
  });
});

describe("shouldReviveOnForeground", () => {
  it("reconnects when the socket died while backgrounded", () => {
    expect(
      shouldReviveOnForeground({
        hidden: false,
        disposed: false,
        readyState: CLOSED,
      }),
    ).toBe(true);
  });

  it("reconnects immediately when sitting in a backoff window", () => {
    // readyState null = no socket at all, i.e. waiting out the backoff. The
    // patient is looking at the screen now; don't make them wait up to 30s.
    expect(
      shouldReviveOnForeground({
        hidden: false,
        disposed: false,
        readyState: null,
      }),
    ).toBe(true);
  });

  it("leaves a healthy socket alone", () => {
    for (const readyState of [CONNECTING, OPEN]) {
      expect(
        shouldReviveOnForeground({ hidden: false, disposed: false, readyState }),
      ).toBe(false);
    }
  });

  it("does nothing while the app is still hidden or unmounted", () => {
    expect(
      shouldReviveOnForeground({
        hidden: true,
        disposed: false,
        readyState: CLOSED,
      }),
    ).toBe(false);
    expect(
      shouldReviveOnForeground({
        hidden: false,
        disposed: true,
        readyState: CLOSED,
      }),
    ).toBe(false);
  });
});

describe("shouldInvalidateOnForeground", () => {
  it("refetches on every real return to the foreground", () => {
    // Even if the socket survived: we can't prove which events were missed
    // while the webview was frozen.
    expect(shouldInvalidateOnForeground({ hidden: false, disposed: false })).toBe(
      true,
    );
  });

  it("does not refetch when hidden or unmounted", () => {
    expect(shouldInvalidateOnForeground({ hidden: true, disposed: false })).toBe(
      false,
    );
    expect(shouldInvalidateOnForeground({ hidden: false, disposed: true })).toBe(
      false,
    );
  });
});
