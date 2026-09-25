"use client";

/**
 * The browser half of the staff session: tells the server when a person is
 * actually there, and sends the browser to /login once the session has ended.
 *
 * Activity. The idle timeout only counts requests a person made (see
 * `src/lib/user-activity.ts`): polling pages such as the live queue talk to
 * the server all day on their own and used to keep an abandoned reception PC
 * signed in for 8 hours. So on real pointer or keyboard input we ask
 * /api/auth/session with the `x-user-activity` header, at most once a minute.
 * Someone working on one screen for 40 minutes stays signed in; a PC nobody
 * touches times out after the clinic's idle window. Mounted in every staff
 * layout (/crm, /doctor, /admin): a staff page without it would time out
 * while in use.
 *
 * Expiry. Since audit SEC-05/SEC-06 every API call re-checks the server-side
 * session: an idle timeout, a newer sign-in on another PC, a password reset or
 * a deactivation now answers 401 on the very next request instead of hours
 * later. Without this watcher a page that only talks to the API (the live
 * queue, «Мой день») would just show failing widgets until someone clicked a
 * link. On a 401 from our own API we ask /api/auth/session whether the session
 * is gone (so an endpoint that uses 401 for something else cannot log anyone
 * out) and, if it is, go to the login page and come back here afterwards. The
 * activity heartbeat gets the same answer, so a person coming back to a timed
 * out PC lands on the login page at their first click.
 */
import * as React from "react";

import {
  ACTIVITY_CLIENT_COOKIE,
  USER_ACTIVITY_HEADER,
} from "@/lib/user-activity";

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

/**
 * Input that only a person produces. Move events are left out on purpose:
 * browsers fire synthetic mouse moves when the page re-renders under a
 * resting cursor, which a polling page does all the time. Scroll is left out
 * too (scripts scroll); wheel, touch and keys cover a person scrolling.
 */
export const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/** Same pace as the server's `ACTIVITY_BUMP_MS`: one write a minute at most. */
export const ACTIVITY_HEARTBEAT_MS = 60_000;

/**
 * Call `send` on real input, at most once per `everyMs`. Returns the cleanup.
 * Listens in the capture phase so a component that stops propagation still
 * counts as being used.
 */
export function startActivityHeartbeat(opts: {
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  send: () => void;
  everyMs?: number;
  now?: () => number;
  /** Script-dispatched events are not a person. */
  isReal?: (e: Event) => boolean;
}): () => void {
  const everyMs = opts.everyMs ?? ACTIVITY_HEARTBEAT_MS;
  const now = opts.now ?? Date.now;
  const isReal = opts.isReal ?? ((e: Event) => e.isTrusted);
  let lastSentAt = -Infinity;
  const onInput = (e: Event) => {
    if (!isReal(e)) return;
    const t = now();
    if (t - lastSentAt < everyMs) return;
    lastSentAt = t;
    opts.send();
  };
  const listenOpts = { capture: true, passive: true } as const;
  for (const type of ACTIVITY_EVENTS) {
    opts.target.addEventListener(type, onInput, listenOpts);
  }
  return () => {
    for (const type of ACTIVITY_EVENTS) {
      opts.target.removeEventListener(type, onInput, listenOpts);
    }
  };
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

    const leave = () => {
      if (leaving) return;
      leaving = true;
      const back = window.location.pathname + window.location.search;
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(back)}`);
    };

    // Ask the server about this session; leave if it is gone. `undefined`
    // means we could not tell (network, 5xx): stay put.
    const askSession = (init: RequestInit = {}) =>
      original("/api/auth/session", { cache: "no-store", ...init })
        .then((r) => (r.ok ? r.json() : undefined))
        .then((session: { user?: unknown } | null | undefined) => {
          if (session === undefined || session?.user) return;
          leave();
        })
        .catch(() => {});

    const confirmAndLeave = () => {
      if (checking || leaving) return;
      checking = true;
      void askSession().finally(() => {
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

    // Tell the server this browser reports input, so its polling stops
    // counting as activity (see src/lib/user-activity.ts). 400 days is the
    // longest a browser keeps a cookie.
    try {
      const secure = window.location.protocol === "https:" ? "; secure" : "";
      document.cookie = `${ACTIVITY_CLIENT_COOKIE}=1; path=/; max-age=34560000; samesite=lax${secure}`;
    } catch {
      // Cookies blocked: the server keeps counting every request, as before.
    }

    const stopHeartbeat = startActivityHeartbeat({
      target: window,
      send: () => {
        if (leaving) return;
        void askSession({ headers: { [USER_ACTIVITY_HEADER]: "1" } });
      },
    });

    return () => {
      stopHeartbeat();
      if (window.fetch === watched) window.fetch = original;
    };
  }, []);
  return null;
}
