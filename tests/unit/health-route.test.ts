/**
 * /api/health — public readiness probe tests.
 *
 * We mock `@/lib/prisma` so the DB check succeeds / fails deterministically.
 * REDIS_URL and MINIO_ENDPOINT are left unset so those branches exercise the
 * `not_configured` / `stub` paths — which do NOT flip the overall status to
 * `down` (they're expected in dev).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbState = { ok: true, errorMessage: "boom" };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(async () => {
      if (!dbState.ok) throw new Error(dbState.errorMessage);
      return [{ "?column?": 1 }];
    }),
  },
}));

// Keep the Redis / MinIO branches hermetic: unset their env vars.
const ORIGINAL = {
  REDIS_URL: process.env.REDIS_URL,
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
};

beforeEach(() => {
  delete process.env.REDIS_URL;
  delete process.env.MINIO_ENDPOINT;
  dbState.ok = true;
});

afterEach(() => {
  if (typeof ORIGINAL.REDIS_URL === "string") process.env.REDIS_URL = ORIGINAL.REDIS_URL;
  if (typeof ORIGINAL.MINIO_ENDPOINT === "string") process.env.MINIO_ENDPOINT = ORIGINAL.MINIO_ENDPOINT;
});

async function loadHandler() {
  // Re-import per test so env changes take effect + we pick up the mock.
  vi.resetModules();
  const mod = await import("@/app/api/health/route");
  return mod.GET;
}

describe("/api/health — public probe", () => {
  it("returns 200 + status=ok when DB responds", async () => {
    const GET = await loadHandler();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.db.status).toBe("ok");
    expect(body.checks.redis.status).toBe("not_configured");
    expect(body.checks.minio.status).toBe("stub");
    expect(body.checks.workers.status).toBe("ok");
    expect(Array.isArray(body.checks.workers.queues)).toBe(true);
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.version).toBe("string");
    expect(typeof body.generatedAt).toBe("string");
  });

  it("returns 503 + status=down when the DB fails", async () => {
    dbState.ok = false;
    dbState.errorMessage = "connection refused";
    const GET = await loadHandler();
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("down");
    expect(body.checks.db.status).toBe("down");
    expect(body.checks.db.error).toContain("connection refused");
  });

  it("sets no-store cache headers", async () => {
    const GET = await loadHandler();
    const res = await GET();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("includes all four checks in the payload", async () => {
    const GET = await loadHandler();
    const res = await GET();
    const body = await res.json();
    const keys = Object.keys(body.checks).sort();
    expect(keys).toEqual(["db", "minio", "redis", "workers"]);
  });
});
