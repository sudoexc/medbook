/**
 * Audit INF-01 — /api/health sees a dead worker.
 *
 * The workers check returned `ok` hard-coded, so a worker in a restart loop
 * left reminders, conclusion delivery, auto no-shows and every outbox event
 * dead for days behind a green watchdog. Now the worker beats a heartbeat in
 * Redis, health judges it (and the tables the worker drains), and the
 * watchdog alerts on anything but ok.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backlog = vi.hoisted(() => ({
  pendingCreatedAt: null as Date | null,
  dead: 0,
  overdueAt: null as Date | null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(async () => [{ "?column?": 1 }]),
    eventOutbox: {
      findFirst: vi.fn(async () =>
        backlog.pendingCreatedAt ? { createdAt: backlog.pendingCreatedAt } : null,
      ),
      count: vi.fn(async () => backlog.dead),
    },
    notificationSend: {
      findFirst: vi.fn(async () =>
        backlog.overdueAt ? { scheduledFor: backlog.overdueAt } : null,
      ),
    },
  },
}));

import {
  HEARTBEAT_KEY,
  PROCESS_LOOP,
  __resetHeartbeatForTests,
  evaluateHeartbeats,
  recordHeartbeat,
  staleAfterMs,
  type OpsRedis,
} from "@/server/observability/worker-heartbeat";
import { workersVerdict } from "@/server/observability/worker-health";

const ENV = { ...process.env };
const NOW = Date.parse("2026-10-01T10:00:00Z");

function fakeRedis(hash: Record<string, string> = {}) {
  const writes: Array<[string, string, string]> = [];
  const client: OpsRedis = {
    ping: async () => "PONG",
    hset: async (key, field, value) => {
      writes.push([key, field, value]);
      hash[field] = value;
      return 1;
    },
    hgetall: async () => ({ ...hash }),
    del: async () => {
      for (const k of Object.keys(hash)) delete hash[k];
      return 1;
    },
  };
  return { client, writes, hash };
}

const beat = (agoMs: number, everyMs: number) =>
  JSON.stringify({ at: NOW - agoMs, everyMs });

beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.MINIO_ENDPOINT;
  backlog.pendingCreatedAt = null;
  backlog.dead = 0;
  backlog.overdueAt = null;
});

afterEach(() => {
  process.env = ENV;
  vi.useRealTimers();
});

describe("how late a loop may be", () => {
  it("two missed ticks plus a minute, never under two minutes", () => {
    expect(staleAfterMs(200)).toBe(120_000);
    expect(staleAfterMs(30_000)).toBe(120_000);
    expect(staleAfterMs(60_000)).toBe(180_000);
    expect(staleAfterMs(60 * 60_000)).toBe(2 * 60 * 60_000 + 60_000);
    expect(staleAfterMs(Number.NaN)).toBe(120_000);
  });
});

describe("the heartbeat verdict", () => {
  it("no process beat: the worker is down", () => {
    expect(evaluateHeartbeats({}, NOW).status).toBe("down");
    expect(evaluateHeartbeats({ "outbox-pumper": beat(1_000, 200) }, NOW).status).toBe("down");
  });

  it("process beat older than two minutes: down (container stopped)", () => {
    const v = evaluateHeartbeats({ [PROCESS_LOOP]: beat(150_000, 30_000) }, NOW);
    expect(v.status).toBe("down");
    expect(v.processAgeSec).toBe(150);
  });

  it("everything fresh: ok", () => {
    const v = evaluateHeartbeats(
      {
        [PROCESS_LOOP]: beat(10_000, 30_000),
        "outbox-pumper": beat(5_000, 200),
        "patient-experience:medication:medication-reminder-tick": beat(50 * 60_000, 60 * 60_000),
      },
      NOW,
    );
    expect(v).toEqual({ status: "ok", processAgeSec: 10, staleLoops: [], loops: 2 });
  });

  it("a loop two ticks late: degraded, named", () => {
    const v = evaluateHeartbeats(
      {
        [PROCESS_LOOP]: beat(10_000, 30_000),
        "outbox-pumper": beat(5 * 60_000, 200),
        "notifications:scheduler:tick": beat(30_000, 60_000),
      },
      NOW,
    );
    expect(v.status).toBe("degraded");
    expect(v.staleLoops).toEqual(["outbox-pumper"]);
  });

  it("garbage in the hash is ignored, not trusted", () => {
    const v = evaluateHeartbeats({ [PROCESS_LOOP]: "not json", x: "{}" }, NOW);
    expect(v.status).toBe("down");
    expect(v.loops).toBe(0);
  });
});

describe("the workers check", () => {
  const fresh = { [PROCESS_LOOP]: beat(5_000, 30_000) };
  const clean = { oldestPendingSec: null, dead24h: 0, oldestOverdueSec: null };

  it("no Redis: not_configured (not a made-up ok)", () => {
    expect(workersVerdict(null, clean, NOW).status).toBe("not_configured");
  });

  it("an outbox row undelivered for more than a minute: degraded", () => {
    expect(workersVerdict(fresh, { ...clean, oldestPendingSec: 61 }, NOW).status).toBe("degraded");
    expect(workersVerdict(fresh, { ...clean, oldestPendingSec: 30 }, NOW).status).toBe("ok");
  });

  it("a dead-lettered event in the last day, or a stuck notification: degraded", () => {
    expect(workersVerdict(fresh, { ...clean, dead24h: 1 }, NOW).status).toBe("degraded");
    expect(workersVerdict(fresh, { ...clean, oldestOverdueSec: 3600 }, NOW).status).toBe("degraded");
  });

  it("a stopped process wins over everything: down", () => {
    expect(workersVerdict({}, { ...clean, oldestPendingSec: 600 }, NOW).status).toBe("down");
  });

  it("status comes first in the JSON (the watchdog greps `\"workers\":{\"status\":\"<status>\"`)", () => {
    expect(Object.keys(workersVerdict(fresh, clean, NOW))[0]).toBe("status");
  });
});

describe("/api/health with Redis (the acceptance scenario)", () => {
  async function health(hash: Record<string, string>) {
    process.env.REDIS_URL = "redis://test:6379";
    vi.resetModules();
    const hb = await import("@/server/observability/worker-heartbeat");
    hb.__resetHeartbeatForTests(fakeRedis(hash).client);
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    return { status: res.status, body: await res.json() };
  }

  it("worker container stopped (beat 3 min old): workers down, overall degraded, HTTP 200", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { status, body } = await health({ [PROCESS_LOOP]: beat(180_000, 30_000) });
    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.workers.status).toBe("down");
    expect(body.checks.redis.status).toBe("ok");
  });

  it("worker back: ok again", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { body } = await health({
      [PROCESS_LOOP]: beat(5_000, 30_000),
      "outbox-pumper": beat(2_000, 200),
    });
    expect(body.status).toBe("ok");
    expect(body.checks.workers).toMatchObject({ status: "ok", staleLoops: [], loops: 1 });
  });

  it("an outbox row pending for 2 minutes: degraded even with a live process", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    backlog.pendingCreatedAt = new Date(NOW - 120_000);
    const { body } = await health({ [PROCESS_LOOP]: beat(5_000, 30_000) });
    expect(body.status).toBe("degraded");
    expect(body.checks.workers.status).toBe("degraded");
    expect(body.checks.workers.outbox.oldestPendingSec).toBe(120);
  });
});

describe("the worker writes the beats", () => {
  it("throttled per loop, retried after a failed write", async () => {
    process.env.REDIS_URL = "redis://test:6379";
    const { client, writes } = fakeRedis();
    __resetHeartbeatForTests(client);
    recordHeartbeat("outbox-pumper", 200, NOW);
    recordHeartbeat("outbox-pumper", 200, NOW + 200);
    recordHeartbeat("outbox-pumper", 200, NOW + 14_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toBe(HEARTBEAT_KEY);
    expect(JSON.parse(writes[0]![2])).toEqual({ at: NOW, everyMs: 200 });
    recordHeartbeat("outbox-pumper", 200, NOW + 16_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toHaveLength(2);

    const failing: OpsRedis = { ...client, hset: async () => { throw new Error("down"); } };
    __resetHeartbeatForTests(failing);
    recordHeartbeat("x", 1000, NOW);
    await new Promise((r) => setTimeout(r, 0));
    __resetHeartbeatForTests(client);
    recordHeartbeat("x", 1000, NOW + 1);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes.map((w) => w[1])).toContain("x");
  });

  it("without REDIS_URL nothing is written (dev, tests)", async () => {
    delete process.env.REDIS_URL;
    const { client, writes } = fakeRedis();
    __resetHeartbeatForTests(client);
    recordHeartbeat("outbox-pumper", 200, NOW);
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toEqual([]);
  });
});

describe("every repeating job beats, on registration and after each tick", () => {
  it("in-memory adapter", async () => {
    vi.resetModules();
    const spy = vi.fn();
    vi.doMock("@/server/observability/worker-heartbeat", () => ({ recordHeartbeat: spy }));
    delete process.env.REDIS_URL;
    const { getQueue, __setQueueForTests } = await import("@/server/queue");
    __setQueueForTests(null);
    const q = getQueue();
    let ran = 0;
    q.registerWorker("t", "tick", async () => {
      ran += 1;
    });
    const handle = q.repeat("t", "tick", {}, 10);
    expect(spy).toHaveBeenCalledWith("t:tick", 10);
    await new Promise((r) => setTimeout(r, 35));
    handle.stop();
    expect(ran).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
    await q.shutdown();
    __setQueueForTests(null);
    vi.doUnmock("@/server/observability/worker-heartbeat");
  });

  it("BullMQ adapter: the processor beats a repeating job with its cadence", () => {
    const src = readFileSync(path.join(process.cwd(), "src/server/queue/bullmq-adapter.ts"), "utf8");
    expect(src).toContain("this.repeatEvery.set(key, intervalMs)");
    expect(src).toMatch(/await h\(job\.data\);\s+const every = this\.repeatEvery\.get\(jobKey\);/);
  });
});

describe("the wiring around it", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("the worker clears stale loops, then beats as a process, and the pumper beats", () => {
    const start = read("src/server/workers/start.ts");
    const reset = start.indexOf("await resetHeartbeats()");
    expect(reset).toBeGreaterThan(-1);
    expect(start.indexOf("startProcessHeartbeat(")).toBeGreaterThan(reset);
    expect(start.indexOf("startNotificationsSendWorker()")).toBeGreaterThan(reset);
    expect(read("src/server/workers/outbox-pumper.ts")).toContain(
      'recordHeartbeat("outbox-pumper", intervalMs)',
    );
  });

  it("the worker container has a healthcheck on the beat file", () => {
    const compose = read("docker-compose.yml");
    const worker = compose.slice(compose.indexOf("  worker:"), compose.indexOf("  nginx:"));
    expect(worker).toContain("healthcheck:");
    expect(worker).toContain("/tmp/medbook-worker.heartbeat");
  });

  it("the watchdog alerts through ALERT_TG_* (falls back to the old names) and logs otherwise", () => {
    const wd = read("ops/watchdog.sh");
    expect(wd).toContain('ALERT_TG_TOKEN:=${TELEGRAM_BOT_TOKEN:-}');
    expect(wd).toContain('ALERT_TG_CHAT_ID:=${WATCHDOG_TG_CHAT_ID:-}');
    expect(wd).toContain("alert not sent");
    // Reads each subsystem's status (not only "ok or not"): degraded and down
    // are separate problems (tests/unit/p5-watchdog-alerts.test.ts).
    expect(wd).toContain('"\\"${svc}\\":{\\"status\\":\\"[a-z_]*\\""');
    expect(read(".env.example")).toMatch(/^ALERT_TG_TOKEN=$/m);
  });

  it("the public probe never returns error text", () => {
    expect(read("src/app/api/health/route.ts")).not.toMatch(/error: e instanceof Error/);
  });
});
