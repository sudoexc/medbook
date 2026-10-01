/**
 * Worker liveness heartbeats (audit INF-01).
 *
 * `/api/health` used to answer `workers: ok` unconditionally, so a worker in
 * a restart loop (a broken `.env`, a crash at boot, OOM) left reminders,
 * conclusion delivery, auto no-shows and every outbox event dead for days
 * while the watchdog saw green. The worker is a separate container: the app
 * can only know it is alive if the worker says so somewhere both can read.
 *
 * The worker writes one Redis hash, `medbook:worker:heartbeats`:
 *
 *   field  = loop name ("process", "outbox-pumper", "<queue>:<job>")
 *   value  = JSON `{ at: epochMs, everyMs }`
 *
 *   - "process" is beaten every 30 s by a dedicated timer: the process and
 *     its event loop are alive.
 *   - every repeating job (queue adapters) and the outbox pumper beat after
 *     each tick: that loop still runs, at the cadence it registered.
 *
 * `/api/health` reads the hash and judges each entry against its own cadence
 * (`staleAfterMs`): the process beat older than two minutes means the worker
 * is down; a loop two ticks late means it is degraded.
 *
 * Writes are throttled per loop (the pumper ticks every 200 ms) and never
 * throw: a heartbeat must not take a worker down. Without `REDIS_URL` (dev,
 * tests) there is no channel between the processes and every call is a
 * no-op; health then reports the check as `not_configured`.
 */

export const HEARTBEAT_KEY = "medbook:worker:heartbeats";

/** The loop name of the process-level beat. */
export const PROCESS_LOOP = "process";

/** Cadence of the process-level beat. */
export const PROCESS_BEAT_EVERY_MS = 30_000;

/** A local file the container healthcheck reads (docker-compose.yml). */
export const PROCESS_BEAT_FILE = "/tmp/medbook-worker.heartbeat";

/** At most one Redis write per loop in this window. */
const WRITE_THROTTLE_MS = 15_000;

export type HeartbeatRecord = { at: number; everyMs: number };

/**
 * How old a beat may get before its loop counts as stopped: two missed ticks
 * plus a minute of slack, never under two minutes (the write throttle and a
 * slow tick must not flap the status). The 200 ms pumper and the 30 s
 * process beat are late after 2 min, the hourly reminder after ~2 h.
 */
export function staleAfterMs(everyMs: number): number {
  const every = Number.isFinite(everyMs) && everyMs > 0 ? everyMs : 0;
  return Math.max(2 * every + 60_000, 120_000);
}

export type WorkerLoopsVerdict = {
  /** `down`: no process beat, or it stopped. `degraded`: a loop is late. */
  status: "ok" | "degraded" | "down";
  /** Seconds since the process beat, null when there is none. */
  processAgeSec: number | null;
  /** Loops whose beat is older than their cadence allows. */
  staleLoops: string[];
  /** How many loops (process excluded) reported at all. */
  loops: number;
};

/** Pure verdict over the hash contents. Exported for tests. */
export function evaluateHeartbeats(
  raw: Record<string, string>,
  now: number,
): WorkerLoopsVerdict {
  const records = new Map<string, HeartbeatRecord>();
  for (const [name, value] of Object.entries(raw)) {
    const rec = parseRecord(value);
    if (rec) records.set(name, rec);
  }
  const proc = records.get(PROCESS_LOOP);
  const processAgeSec = proc ? Math.max(0, Math.round((now - proc.at) / 1000)) : null;
  const processAlive =
    proc !== undefined && now - proc.at <= staleAfterMs(proc.everyMs);

  const staleLoops: string[] = [];
  let loops = 0;
  for (const [name, rec] of records) {
    if (name === PROCESS_LOOP) continue;
    loops += 1;
    if (now - rec.at > staleAfterMs(rec.everyMs)) staleLoops.push(name);
  }
  staleLoops.sort();

  const status = !processAlive ? "down" : staleLoops.length > 0 ? "degraded" : "ok";
  return { status, processAgeSec, staleLoops, loops };
}

function parseRecord(value: string): HeartbeatRecord | null {
  try {
    const v = JSON.parse(value) as Partial<HeartbeatRecord>;
    if (typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    const everyMs = typeof v.everyMs === "number" && v.everyMs > 0 ? v.everyMs : 0;
    return { at: v.at, everyMs };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis (one lazy connection per process, shared by the writer and /api/health)
// ─────────────────────────────────────────────────────────────────────────────

export type OpsRedis = {
  ping(): Promise<string>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<unknown>;
};

let clientPromise: Promise<OpsRedis | null> | null = null;

/**
 * The process-wide ops Redis client, or null without `REDIS_URL`. One
 * connection reused for every call: the public health probe used to open a
 * fresh TCP connection to Redis on each unauthenticated request.
 */
export function getOpsRedis(): Promise<OpsRedis | null> {
  if (!process.env.REDIS_URL) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        // Lazy import: tests and dev without Redis never load the driver.
        const mod = (await import("ioredis")) as unknown as {
          default: new (
            url: string,
            opts: Record<string, unknown>,
          ) => OpsRedis & { on(ev: string, fn: (e: unknown) => void): void };
        };
        const client = new mod.default(process.env.REDIS_URL!, {
          // Fail a command fast instead of queueing it forever while Redis
          // is away: callers are a probe and a best-effort beat.
          maxRetriesPerRequest: 1,
          connectTimeout: 3_000,
        });
        client.on("error", (e) => {
          console.warn(`[heartbeat] redis error: ${(e as Error)?.message ?? e}`);
        });
        return client;
      } catch (e) {
        console.warn(`[heartbeat] redis unavailable: ${(e as Error).message}`);
        clientPromise = null;
        return null;
      }
    })();
  }
  return clientPromise;
}

/** Test seam: forget the cached client (and the write throttle). */
export function __resetHeartbeatForTests(client?: OpsRedis | null): void {
  clientPromise = client === undefined ? null : Promise.resolve(client);
  lastWrite.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Writer (worker process)
// ─────────────────────────────────────────────────────────────────────────────

const lastWrite = new Map<string, number>();

/**
 * Record that `name` just ran. `everyMs` is the loop's cadence, stored with
 * the beat so the reader can judge lateness without a registry of loops.
 * Throttled per loop, fire-and-forget, never throws.
 */
export function recordHeartbeat(
  name: string,
  everyMs: number,
  now: number = Date.now(),
): void {
  if (!process.env.REDIS_URL) return;
  const prev = lastWrite.get(name);
  if (prev !== undefined && now - prev < WRITE_THROTTLE_MS) return;
  lastWrite.set(name, now);
  const value = JSON.stringify({ at: now, everyMs } satisfies HeartbeatRecord);
  void getOpsRedis()
    .then((c) => c?.hset(HEARTBEAT_KEY, name, value))
    .catch((e) => {
      // A failed write must be retried on the next tick, not throttled away.
      lastWrite.delete(name);
      console.warn(`[heartbeat] write ${name} failed: ${(e as Error)?.message ?? e}`);
    });
}

/**
 * Drop every recorded loop. Called once when the worker boots, before the
 * loops register again: a loop removed from the code (or renamed) must not
 * stay in the hash as forever late.
 */
export async function resetHeartbeats(): Promise<void> {
  lastWrite.clear();
  try {
    // Bounded: a slow Redis must not hold back every worker's start; the
    // loops beat again on registration either way.
    await Promise.race([
      (async () => {
        const c = await getOpsRedis();
        await c?.del(HEARTBEAT_KEY);
      })(),
      new Promise((resolve) => setTimeout(resolve, 5_000).unref?.()),
    ]);
  } catch (e) {
    console.warn(`[heartbeat] reset failed: ${(e as Error)?.message ?? e}`);
  }
}

/**
 * Start the process-level beat: Redis for `/api/health`, a local file for
 * the container healthcheck. Unref'd: it reports liveness, it does not own it.
 */
export function startProcessHeartbeat(
  writeFile: (path: string, data: string) => void,
): { stop: () => void } {
  const beat = () => {
    // The process beat is never throttled away: one per interval.
    lastWrite.delete(PROCESS_LOOP);
    recordHeartbeat(PROCESS_LOOP, PROCESS_BEAT_EVERY_MS);
    try {
      writeFile(PROCESS_BEAT_FILE, String(Date.now()));
    } catch (e) {
      console.warn(`[heartbeat] file beat failed: ${(e as Error)?.message ?? e}`);
    }
  };
  beat();
  const handle = setInterval(beat, PROCESS_BEAT_EVERY_MS);
  handle.unref?.();
  return { stop: () => clearInterval(handle) };
}

/** Read every recorded beat (health probe). Null without Redis. */
export async function readHeartbeats(): Promise<Record<string, string> | null> {
  const c = await getOpsRedis();
  if (!c) return null;
  return c.hgetall(HEARTBEAT_KEY);
}
