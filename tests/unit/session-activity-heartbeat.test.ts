import { describe, expect, it, vi } from "vitest";

/**
 * Audit SEC-06, review of 4308b0f: the idle timeout never fired on pages that
 * poll (reception queue, calendar, Telegram inbox, call center), because every
 * authenticated request bumped `lastActivityAt`. Now only a person's request
 * counts: the browser sends an activity heartbeat on real pointer / keyboard
 * input (at most once a minute), and the server counts that header or a full
 * page load, nothing else.
 */
import {
  ACTIVITY_EVENTS,
  ACTIVITY_HEARTBEAT_MS,
  startActivityHeartbeat,
} from "@/components/auth/session-expiry-watch";
import {
  ACTIVITY_CLIENT_COOKIE,
  USER_ACTIVITY_HEADER,
  isUserActivityRequest,
} from "@/lib/user-activity";

function setup(opts: { isReal?: (e: Event) => boolean } = {}) {
  const target = new EventTarget();
  const send = vi.fn();
  let clock = 0;
  const stop = startActivityHeartbeat({
    target,
    send,
    now: () => clock,
    isReal: opts.isReal ?? (() => true),
  });
  return {
    target,
    send,
    stop,
    at(ms: number) {
      clock = ms;
    },
    fire(type: string) {
      target.dispatchEvent(new Event(type));
    },
  };
}

describe("activity heartbeat (browser side)", () => {
  it("sends on real input, at most once a minute", () => {
    const t = setup();
    t.fire("keydown");
    expect(t.send).toHaveBeenCalledTimes(1);
    t.at(10_000);
    t.fire("pointerdown");
    t.fire("wheel");
    expect(t.send).toHaveBeenCalledTimes(1);
    t.at(ACTIVITY_HEARTBEAT_MS);
    t.fire("touchstart");
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("someone clicking through one screen for 40 minutes sends a heartbeat every minute", () => {
    const t = setup();
    for (let s = 0; s <= 40 * 60; s += 20) {
      t.at(s * 1000);
      t.fire("pointerdown");
    }
    expect(t.send).toHaveBeenCalledTimes(41);
  });

  it("nothing is sent while nobody touches the PC, whatever the page does", () => {
    const t = setup();
    // Re-renders under a resting cursor and programmatic scrolling fire these.
    for (const type of ["mousemove", "pointermove", "scroll", "focus", "visibilitychange"]) {
      t.fire(type);
    }
    expect(t.send).not.toHaveBeenCalled();
    expect(ACTIVITY_EVENTS).not.toContain("mousemove");
    expect(ACTIVITY_EVENTS).not.toContain("scroll");
  });

  it("script-dispatched events are not a person", () => {
    // Default check: Event#isTrusted, which is false for dispatchEvent().
    const target = new EventTarget();
    const send = vi.fn();
    startActivityHeartbeat({ target, send });
    target.dispatchEvent(new Event("keydown"));
    expect(send).not.toHaveBeenCalled();
  });

  it("stops listening on cleanup", () => {
    const t = setup();
    t.stop();
    t.fire("keydown");
    expect(t.send).not.toHaveBeenCalled();
  });
});

describe("which requests count as activity (server side)", () => {
  // A browser running the current SessionExpiryWatch carries this cookie.
  const cookie = `authjs.session-token=x; ${ACTIVITY_CLIENT_COOKIE}=1; NEXT_LOCALE=ru`;

  it("the heartbeat header and a full page load count; polling does not", () => {
    expect(isUserActivityRequest(new Headers({ cookie, [USER_ACTIVITY_HEADER]: "1" }))).toBe(true);
    expect(
      isUserActivityRequest(new Headers({ cookie, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })),
    ).toBe(true);
    expect(isUserActivityRequest(new Headers({ cookie, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }))).toBe(false);
    expect(isUserActivityRequest(new Headers({ cookie, accept: "text/event-stream" }))).toBe(false);
    expect(isUserActivityRequest(new Headers({ cookie }))).toBe(false);
    expect(isUserActivityRequest(new Headers({ cookie, [USER_ACTIVITY_HEADER]: "0" }))).toBe(false);
  });

  it("a tab opened before the heartbeat shipped keeps the old counting until it reloads", () => {
    // Its script never reports input, so judging it strictly would log out a
    // receptionist working on one page one idle window after the deploy.
    expect(isUserActivityRequest(new Headers({ "sec-fetch-mode": "cors" }))).toBe(true);
    expect(isUserActivityRequest(new Headers({ cookie: "authjs.session-token=x" }))).toBe(true);
    expect(isUserActivityRequest(new Headers({ cookie: `${ACTIVITY_CLIENT_COOKIE}=0` }))).toBe(true);
  });
});
