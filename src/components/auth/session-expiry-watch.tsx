"use client";

/**
 * Sends the browser to /login once its staff session has really ended.
 *
 * Since audit SEC-05/SEC-06 every API call re-checks the server-side session:
 * an idle timeout, a newer sign-in on another PC, a password reset or a
 * deactivation now answers 401 on the very next request instead of hours
 * later. Without this watcher a page that only talks to the API (the live
 * queue, «Мой день») would just show failing widgets until someone clicked a
 * link. On a 401 from our own API we ask /api/auth/session whether the session
 * is gone (so an endpoint that uses 401 for something else cannot log anyone
 * out) and, if it is, go to the login page and come back here afterwards.
 */
import * as React from "react";

/** A same-origin staff API call whose 401 may mean "session ended". */
export function isSessionScopedApi(url: string, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  if (!parsed.pathname.startsWith("/api/")) return false;
  // NextAuth's own endpoints, the login pre-flight and the patient-facing
  // Mini App say 401 for reasons that have nothing to do with this session.
  return !/^\/api\/(auth|miniapp|public|kiosk|c)\//.test(parsed.pathname) &&
    parsed.pathname !== "/api/crm/auth/totp-required";
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function SessionExpiryWatch() {
  React.useEffect(() => {
    const original = window.fetch;
    let checking = false;
    let leaving = false;

    const confirmAndLeave = () => {
      if (checking || leaving) return;
      checking = true;
      original("/api/auth/session", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : undefined))
        .then((session: { user?: unknown } | null | undefined) => {
          // `undefined` = we could not tell (network, 5xx): stay put.
          if (session === undefined || session?.user) return;
          leaving = true;
          const back = window.location.pathname + window.location.search;
          window.location.assign(`/login?callbackUrl=${encodeURIComponent(back)}`);
        })
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    };

    const watched: typeof window.fetch = async (input, init) => {
      const res = await original(input, init);
      if (
        res.status === 401 &&
        isSessionScopedApi(requestUrl(input), window.location.origin)
      ) {
        confirmAndLeave();
      }
      return res;
    };
    window.fetch = watched;
    return () => {
      if (window.fetch === watched) window.fetch = original;
    };
  }, []);
  return null;
}
