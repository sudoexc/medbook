/**
 * Per-row retry backoff for the durable document sweeps (audit INF-16).
 *
 * The conclusion, medication-bridge and referral sweeps pick the oldest
 * unfinished rows, 25 per tick. A row whose render always throws used to stay
 * at the head of that order forever: 25 of them and every tick re-tried the
 * same broken rows while new conclusions of all patients stopped reaching the
 * Mini App, with nothing but a console line to show for it.
 *
 * Each sweep now remembers its failed rows here and leaves them out of the
 * next query until their delay runs out (1 min, doubling, capped at 1 h), so
 * healthy rows behind them keep flowing. The memory is per worker process on
 * purpose: no schema change, and a restart (usually a deploy that may carry
 * the fix) simply retries every row once. Lasting visibility comes from
 * `/api/health`, which reports documents still undelivered after 30 minutes
 * straight from the tables (src/server/observability/worker-health.ts).
 */

export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
/** An entry not touched for this long belongs to a row that left the sweep. */
const FORGET_AFTER_MS = 24 * 60 * 60_000;
/** After this many failures in a row the log line says so loudly, once. */
export const LOUD_AFTER_ATTEMPTS = 5;

type Entry = {
  /** What the row looked like when it failed; an edit starts over. */
  version: string;
  attempts: number;
  nextAt: number;
  lastAt: number;
};

export class SweepBackoff {
  private readonly entries = new Map<string, Entry>();

  /**
   * Ids still waiting out their delay at `now`, for the query's `notIn`.
   * Also forgets entries nobody has touched for a day.
   */
  waiting(now: number): string[] {
    const out: string[] = [];
    for (const [id, e] of this.entries) {
      if (now - e.lastAt > FORGET_AFTER_MS) {
        this.entries.delete(id);
        continue;
      }
      if (e.nextAt > now) out.push(id);
    }
    return out;
  }

  /**
   * Record a failed attempt and return how many in a row this version of
   * the row has now failed. A different `version` (the row was edited since)
   * counts from one again.
   */
  fail(id: string, version: string, now: number): number {
    const prev = this.entries.get(id);
    const attempts = prev && prev.version === version ? prev.attempts + 1 : 1;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
    this.entries.set(id, { version, attempts, nextAt: now + delay, lastAt: now });
    return attempts;
  }

  /**
   * Set aside a row that cannot be processed as it stands (a blank handout)
   * for the longest delay, without counting it as a failure.
   */
  park(id: string, version: string, now: number): void {
    this.entries.set(id, { version, attempts: 0, nextAt: now + BACKOFF_MAX_MS, lastAt: now });
  }

  succeed(id: string): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }
}

/** The console line for a failed row: plain, then loud once it looks permanent. */
export function logSweepFailure(
  tag: string,
  what: string,
  attempts: number,
  err: unknown,
): void {
  if (attempts === LOUD_AFTER_ATTEMPTS) {
    console.error(
      `[${tag}] ${what} failed ${attempts} times in a row and still has not reached ` +
        `the patient. Retrying at most hourly; /api/health reports it as undelivered.`,
      err,
    );
    return;
  }
  console.error(`[${tag}] ${what} failed (attempt ${attempts})`, err);
}
