/**
 * Which requests prove that a person is at the keyboard (audit SEC-06, review
 * of the idle timeout).
 *
 * The idle timeout keys off `UserSession.lastActivityAt`. Counting every
 * authenticated request as activity meant it never fired where it matters
 * most: the reception queue, the calendar, the Telegram inbox and the call
 * center all poll the API on their own, so a receptionist who walked away
 * from /crm/reception stayed signed in until the 8h cap, and whoever sat down
 * at the PC worked under her account. Now only two kinds of request count:
 *
 *   - the client's input heartbeat: `SessionExpiryWatch` sends one request
 *     with this header after real pointer or keyboard input, at most once a
 *     minute, so someone working 40 minutes on one screen is never logged out;
 *   - a full page load (`Sec-Fetch-Mode: navigate` for a document): a typed
 *     URL, a bookmark, F5.
 *
 * Polling, SSE, `router.refresh()` and prefetches carry neither, whatever page
 * or hook they come from, so a new poller cannot quietly bring the problem
 * back.
 *
 * One exception, for the switch-over: a tab opened before the heartbeat
 * shipped runs the old script, which never reports input. Judged strictly, a
 * receptionist working in such a tab without changing page would be logged
 * out mid-appointment one idle window after the deploy. The new script marks
 * its browser with a cookie (`ACTIVITY_CLIENT_COOKIE`); a browser without the
 * mark is counted the old way until its next page load sets it.
 */

export const USER_ACTIVITY_HEADER = "x-user-activity";

/** Set by `SessionExpiryWatch`: this browser reports real input. */
export const ACTIVITY_CLIENT_COOKIE = "mb_activity_hb";

type HeaderBag = { get(name: string): string | null };

function reportsInput(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((c) => c.trim() === `${ACTIVITY_CLIENT_COOKIE}=1`);
}

export function isUserActivityRequest(headers: HeaderBag): boolean {
  if (headers.get(USER_ACTIVITY_HEADER) === "1") return true;
  if (
    headers.get("sec-fetch-mode") === "navigate" &&
    headers.get("sec-fetch-dest") === "document"
  ) {
    return true;
  }
  return !reportsInput(headers.get("cookie"));
}
